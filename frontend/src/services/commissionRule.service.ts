import { api } from './api';
import type { CommissionRule, RuleScope } from '@shared/types';

export interface CommissionRuleWithCount extends CommissionRule {
  assignmentCount: number;
}

export const commissionRuleApiService = {
  async getAll(filter?: { archived?: boolean }): Promise<CommissionRuleWithCount[]> {
    const params = filter?.archived !== undefined ? `?archived=${filter.archived}` : '';
    const res = await api.get<{ success: true; data: CommissionRuleWithCount[] }>(
      `/commission-rules${params}`,
    );
    return res.data.data;
  },

  async generate(data: {
    name: string;
    description: string;
    dealType?: string | null;
    scope?: RuleScope;
  }): Promise<CommissionRule> {
    const res = await api.post<{ success: true; data: CommissionRule }>(
      '/commission-rules/generate',
      data,
    );
    return res.data.data;
  },

  async archive(ruleId: string): Promise<CommissionRule> {
    const res = await api.patch<{ success: true; data: CommissionRule }>(
      `/commission-rules/${ruleId}/archive`,
    );
    return res.data.data;
  },

  async unarchive(ruleId: string): Promise<CommissionRule> {
    const res = await api.patch<{ success: true; data: CommissionRule }>(
      `/commission-rules/${ruleId}/unarchive`,
    );
    return res.data.data;
  },
};
