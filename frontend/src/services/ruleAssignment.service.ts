import { api } from './api';
import type { RuleAssignment, AssigneeType } from '@shared/types';

export const ruleAssignmentApiService = {
  async getForUser(userId: string): Promise<RuleAssignment[]> {
    const res = await api.get<{ success: true; data: RuleAssignment[] }>(
      `/rule-assignments/user/${userId}`,
    );
    return res.data.data;
  },

  async assign(data: {
    ruleId: string;
    assignedToType: AssigneeType;
    userId?: string | null;
    teamName?: string | null;
    startDate?: string;
    endDate?: string | null;
  }): Promise<RuleAssignment> {
    const res = await api.post<{ success: true; data: RuleAssignment }>(
      '/rule-assignments',
      data,
    );
    return res.data.data;
  },

  async deactivate(assignmentId: string): Promise<RuleAssignment> {
    const res = await api.patch<{ success: true; data: RuleAssignment }>(
      `/rule-assignments/${assignmentId}/deactivate`,
    );
    return res.data.data;
  },
};
