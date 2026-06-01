import { api } from './api';
import type { PayrollReportPreview } from '@shared/types';

export const payrollReportService = {
  async preview(year: number, month: number, userId?: string): Promise<PayrollReportPreview> {
    const params = new URLSearchParams({ year: year.toString(), month: month.toString() });
    if (userId) params.set('userId', userId);
    const res = await api.get<{ success: true; data: PayrollReportPreview }>(
      `/reports/payroll/preview?${params.toString()}`,
    );
    return res.data.data;
  },

  async downloadPdf(year: number, month: number, userId?: string): Promise<void> {
    const params = new URLSearchParams({ year: year.toString(), month: month.toString() });
    if (userId) params.set('userId', userId);

    const res = await api.get(`/reports/payroll/pdf?${params.toString()}`, {
      responseType: 'blob',
    });

    const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `rapport-paie-${year}-${String(month).padStart(2, '0')}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  },
};
