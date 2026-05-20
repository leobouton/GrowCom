import { api } from './api';
import type { DealAssignment } from '@shared/types';

export const dealAssignmentApiService = {
  async getByDealId(dealId: string): Promise<DealAssignment[]> {
    const res = await api.get<{ success: true; data: DealAssignment[] }>(
      `/deals/${dealId}/assignments`,
    );
    return res.data.data;
  },

  async updateAssignments(
    dealId: string,
    assignments: Array<{ userId: string; share: number; role?: string | null }>,
  ): Promise<DealAssignment[]> {
    const res = await api.put<{ success: true; data: DealAssignment[] }>(
      `/deals/${dealId}/assignments`,
      { assignments },
    );
    return res.data.data;
  },
};
