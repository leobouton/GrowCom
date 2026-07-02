import { api } from './api';
import type { PayrollReportPreview, PayrollLockInfo, PayrollPeriodHistoryItem } from '@shared/types';

function periodParams(year: number, month: number, userIds?: string[]): URLSearchParams {
  const params = new URLSearchParams({ year: year.toString(), month: month.toString() });
  if (userIds && userIds.length > 0) params.set('userIds', userIds.join(','));
  return params;
}

function triggerDownload(data: BlobPart, type: string, filename: string): void {
  const blob = new Blob([data], { type });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}

export const payrollReportService = {
  async preview(year: number, month: number, userIds?: string[]): Promise<PayrollReportPreview> {
    const res = await api.get<{ success: true; data: PayrollReportPreview }>(
      `/reports/payroll/preview?${periodParams(year, month, userIds).toString()}`,
    );
    return res.data.data;
  },

  async history(): Promise<PayrollPeriodHistoryItem[]> {
    const res = await api.get<{ success: true; data: PayrollPeriodHistoryItem[] }>(
      '/reports/payroll/history',
    );
    return res.data.data;
  },

  async generate(year: number, month: number): Promise<PayrollLockInfo> {
    const res = await api.post<{ success: true; data: PayrollLockInfo }>(
      '/reports/payroll/generate',
      { year, month },
    );
    return res.data.data;
  },

  async downloadPdf(year: number, month: number, userIds?: string[]): Promise<void> {
    const res = await api.get(`/reports/payroll/pdf?${periodParams(year, month, userIds).toString()}`, {
      responseType: 'blob',
    });
    triggerDownload(res.data as BlobPart, 'application/pdf', `releve-variable-${year}-${String(month).padStart(2, '0')}.pdf`);
  },

  async downloadPdfZip(year: number, month: number, userIds?: string[]): Promise<void> {
    const res = await api.get(`/reports/payroll/pdf/zip?${periodParams(year, month, userIds).toString()}`, {
      responseType: 'blob',
    });
    triggerDownload(res.data as BlobPart, 'application/zip', `releves-variable-${year}-${String(month).padStart(2, '0')}.zip`);
  },

  async downloadExport(year: number, month: number, format: 'csv' | 'xlsx', userIds?: string[]): Promise<void> {
    const params = periodParams(year, month, userIds);
    params.set('format', format);
    const res = await api.get(`/reports/payroll/export?${params.toString()}`, { responseType: 'blob' });
    const type = format === 'csv'
      ? 'text/csv;charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    triggerDownload(res.data as BlobPart, type, `paie-variable-${year}-${String(month).padStart(2, '0')}.${format}`);
  },
};
