import { api } from './api';
import type { Contest, ContestLeaderboardEntry, ContestMetric, RuleScope } from '@shared/types';

interface CreateContestData {
  name: string;
  description: string;
  prize: string;
  metric: ContestMetric;
  scope: RuleScope;
  teamName?: string | null;
  participantIds?: string[];
  periodStart: string;
  periodEnd: string;
}

export const contestApiService = {
  async getAll(): Promise<Contest[]> {
    const res = await api.get<{ success: true; data: Contest[] }>('/contests');
    return res.data.data;
  },

  async create(data: CreateContestData): Promise<Contest> {
    const res = await api.post<{ success: true; data: Contest }>('/contests', data);
    return res.data.data;
  },

  async end(id: string): Promise<Contest> {
    const res = await api.patch<{ success: true; data: Contest }>(`/contests/${id}/end`);
    return res.data.data;
  },

  async cancel(id: string): Promise<Contest> {
    const res = await api.patch<{ success: true; data: Contest }>(`/contests/${id}/cancel`);
    return res.data.data;
  },

  async getLeaderboard(id: string): Promise<ContestLeaderboardEntry[]> {
    const res = await api.get<{ success: true; data: ContestLeaderboardEntry[] }>(`/contests/${id}/leaderboard`);
    return res.data.data;
  },
};
