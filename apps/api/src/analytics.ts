import { isSameDay, startOfDay } from 'date-fns';
import { weightedPipeline, winRate, type CGBSState, type TargetMetric, type TargetPeriod } from '../../../packages/shared/dist/index.js';
import { dateKeyInTimezone } from './targetService.js';

const connectedOutcomes = ['Answered', 'Interested', 'Meeting Scheduled'];
const closedDate = (opp: CGBSState['opportunities'][number]) => opp.actualCloseAt || opp.updatedAt;

export function calculateMetrics(data: CGBSState, anchor = new Date()) {
  const live = data.leads.filter((lead) => !lead.archived);
  const todayKey = dateKeyInTimezone(anchor, data.settings.timezone || 'Asia/Kolkata');
  const targetValue = (metric: TargetMetric, period: TargetPeriod, fallback: number) => {
    const matches = data.targets.filter((target) => target.metric === metric && target.period === period && target.ownerType === 'self' && target.startDate <= todayKey && target.endDate >= todayKey);
    const current = matches.find((target) => target.enabled) || matches[0];
    return current ? current.enabled ? current.targetValue : 0 : fallback;
  };
  const callTargetValue = targetValue('calls', 'daily', data.settings.dailyCallTarget);
  const followUpTargetValue = targetValue('followups_completed', 'daily', data.settings.dailyFollowUpTarget ?? 8);
  const meetingTargetValue = targetValue('meetings_scheduled', 'daily', data.settings.dailyMeetingTarget ?? 3);
  const monthlyRevenueTargetValue = targetValue('revenue', 'monthly', data.settings.monthlyRevenueTarget);
  const todayCalls = data.calls.filter((call) => isSameDay(new Date(call.createdAt), anchor));
  const todayTasks = data.tasks.filter((task) => task.status === 'Due' && isSameDay(new Date(task.dueAt), anchor));
  const completedToday = data.tasks.filter((task) => task.status === 'Completed' && task.completedAt && isSameDay(new Date(task.completedAt), anchor));
  const overdue = data.tasks.filter((task) => task.status === 'Due' && Date.parse(task.dueAt) < anchor.getTime());
  const openOpps = data.opportunities.filter((item) => !['Closed Won', 'Closed Lost'].includes(item.stage));
  const won = data.opportunities.filter((item) => item.stage === 'Closed Won');
  const wonThisMonth = won.filter((opp) => {
    const close = new Date(closedDate(opp));
    return close.getFullYear() === anchor.getFullYear() && close.getMonth() === anchor.getMonth();
  });
  const stageNames = ['New Lead','Contacted','Interested','Follow-up Required','RNR','Meeting Scheduled','Qualified','Proposal Sent','Negotiation','Won','Lost'];
  const leadStatusCounts = stageNames.map((status) => ({ name: status, value: live.filter((lead) => lead.status === status).length }));
  const sourceNames = [...new Set(live.map((lead) => lead.source))].sort();
  const sourceCounts = sourceNames.map((source) => ({ name: source, value: live.filter((lead) => lead.source === source).length }));
  const pipelineStages = ['Qualification','Discovery','Proposal','Negotiation','Closed Won','Closed Lost'].map((stage) => ({
    stage, deals: data.opportunities.filter((opp) => opp.stage === stage).length,
    value: data.opportunities.filter((opp) => opp.stage === stage).reduce((sum, opp) => sum + opp.amount, 0),
  }));
  const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(anchor); day.setDate(day.getDate() - (6 - index));
    const calls = data.calls.filter((call) => isSameDay(new Date(call.createdAt), day));
    const dueCalls = data.tasks.filter((task) => task.type === 'Call' && isSameDay(new Date(task.dueAt), day));
    const tasks = data.tasks.filter((task) => task.status === 'Completed' && task.completedAt && isSameDay(new Date(task.completedAt), day));
    return {
      day: day.toLocaleDateString('en', { weekday: 'short' }),
      attempted: calls.length,
      connected: calls.filter((call) => connectedOutcomes.includes(call.outcome)).length,
      scheduled: dueCalls.length,
      completed: calls.length,
      followUpsCompleted: tasks.length,
      meetingsScheduled: data.tasks.filter((task) => task.type === 'Meeting' && isSameDay(new Date(task.dueAt), day)).length,
    };
  });
  const activityTrend = Array.from({ length: 90 }, (_, index) => {
    const day = new Date(anchor); day.setDate(day.getDate() - (89 - index));
    const calls = data.calls.filter((call) => isSameDay(new Date(call.createdAt), day));
    const tasks = data.tasks.filter((task) => isSameDay(new Date(task.dueAt), day));
    const done = data.tasks.filter((task) => task.status === 'Completed' && task.completedAt && isSameDay(new Date(task.completedAt), day));
    return {
      day: day.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      attempted: calls.length,
      connected: calls.filter((call) => connectedOutcomes.includes(call.outcome)).length,
      scheduled: tasks.filter((task) => task.type === 'Call').length,
      completed: calls.length,
      followUpsCompleted: done.length,
      meetingsScheduled: tasks.filter((task) => task.type === 'Meeting').length,
    };
  });
  const revenueTrend = Array.from({ length: 6 }, (_, i) => {
    const monthDate = new Date(anchor.getFullYear(), anchor.getMonth() - 5 + i, 1);
    const revenue = won.filter((opp) => {
      const closedAt = new Date(closedDate(opp));
      return closedAt.getFullYear() === monthDate.getFullYear() && closedAt.getMonth() === monthDate.getMonth();
    }).reduce((sum, opp) => sum + opp.amount, 0);
    return { month: monthDate.toLocaleDateString('en', { month: 'short' }), revenue, target: monthlyRevenueTargetValue };
  });
  const revenueByOwner = [...new Set(won.map((opp) => opp.owner))].map((owner) => ({ owner, revenue: won.filter((opp) => opp.owner === owner).reduce((sum, opp) => sum + opp.amount, 0) }));
  const revenueByCloser = [...new Set(won.map((opp) => opp.accomplishedByName || opp.owner))].map((closer) => ({ closer, revenue: won.filter((opp) => (opp.accomplishedByName || opp.owner) === closer).reduce((sum, opp) => sum + opp.amount, 0) }));
  const highPriorityAwaitingContact = live.filter((lead) => ['High', 'Critical'].includes(lead.priority) && (!lead.lastContacted || new Date(lead.lastContacted) < startOfDay(anchor)) && !['Won','Lost'].includes(lead.status));
  
  
  const callsScheduledToday = todayTasks.filter((task) => task.type === 'Call').length;
  const meetingsScheduledToday = todayTasks.filter((task) => task.type === 'Meeting').length;
  const revenueThisMonth = wonThisMonth.reduce((sum, opp) => sum + opp.amount, 0);
  return {
    totalLeads: live.length,
    newToday: live.filter((lead) => isSameDay(new Date(lead.createdAt), anchor)).length,
    contacted: live.filter((lead) => lead.lastContacted).length,
    highPriority: live.filter((lead) => ['High','Critical'].includes(lead.priority)).length,
    highPriorityAwaitingContact: highPriorityAwaitingContact.length,
    callsToday: todayCalls.length,
    connectedToday: todayCalls.filter((call) => connectedOutcomes.includes(call.outcome)).length,
    callsRemaining: Math.max(0, callTargetValue - todayCalls.length),
    callsScheduledToday,
    rnrPending: data.tasks.filter((task) => ['RNR callback', 'Call Back Later'].includes(task.type) && task.status === 'Due').length,
    rnrDueToday: todayTasks.filter((task) => task.type === 'RNR callback' || task.type === 'Call Back Later').length,
    followUpsToday: todayTasks.length,
    overdueFollowUps: overdue.length,
    followUpsCompletedToday: completedToday.length,
    meetingsScheduled: data.tasks.filter((task) => task.type === 'Meeting' && task.status === 'Due').length,
    meetingsScheduledToday,
    openOpportunities: openOpps.length,
    closedWonDeals: won.length,
    closedWonDealsThisMonth: wonThisMonth.length,
    openPipeline: openOpps.reduce((sum, opp) => sum + opp.amount, 0),
    weightedPipeline: weightedPipeline(data.opportunities),
    closedWonRevenue: won.reduce((sum, opp) => sum + opp.amount, 0),
    revenueThisMonth,
    remainingRevenueTarget: Math.max(0, monthlyRevenueTargetValue - revenueThisMonth),
    revenueAchievement: monthlyRevenueTargetValue > 0 ? Math.min(100, Math.round(revenueThisMonth / monthlyRevenueTargetValue * 100)) : 0,
    averageDealValue: won.length ? Math.round(won.reduce((sum, opp) => sum + opp.amount, 0) / won.length) : 0,
    conversionRate: live.length ? Math.round(live.filter((lead) => lead.status === 'Won').length / live.length * 100) : 0,
    callTarget: callTargetValue,
    followUpTarget: followUpTargetValue,
    meetingTarget: meetingTargetValue,
    revenueTarget: monthlyRevenueTargetValue,
    winRate: winRate(data.opportunities),
    leadStatusCounts, sourceCounts, pipelineStages, weeklyActivity, activityTrend, revenueTrend, revenueByOwner, revenueByCloser,
  };
}
