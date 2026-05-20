import { clsx } from 'clsx';

type BadgeVariant = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'indigo' | 'purple' | 'orange';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

export function Badge({ children, variant = 'gray', size = 'sm' }: BadgeProps) {
  const variants: Record<BadgeVariant, string> = {
    green: 'bg-green-100 text-green-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
    gray: 'bg-gray-100 text-gray-700',
    indigo: 'bg-primary-100 text-primary-800',
    purple: 'bg-purple-100 text-purple-800',
    orange: 'bg-orange-100 text-orange-800',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium rounded-full',
        variants[variant],
        sizes[size],
      )}
    >
      {children}
    </span>
  );
}

// Helper pour le statut des commissions
export function CommissionStatusBadge({
  status,
  scheduledPaymentAt,
}: {
  status: string;
  scheduledPaymentAt?: string | null;
}) {
  // Commission différée : paiement programmé dans le futur
  if (status === 'PENDING' && scheduledPaymentAt && new Date(scheduledPaymentAt) > new Date()) {
    return <Badge variant="orange">Paiement différé</Badge>;
  }

  const config: Record<string, { label: string; variant: BadgeVariant }> = {
    PENDING: { label: 'En attente', variant: 'yellow' },
    VALIDATED: { label: 'Validée', variant: 'blue' },
    PAID: { label: 'Payée', variant: 'green' },
    CANCELLED: { label: 'Annulée', variant: 'red' },
  };

  const { label, variant } = config[status] ?? { label: status, variant: 'gray' };
  return <Badge variant={variant}>{label}</Badge>;
}

export function DealStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: BadgeVariant }> = {
    OPEN: { label: 'En cours', variant: 'blue' },
    WON: { label: 'Gagné', variant: 'green' },
    LOST: { label: 'Perdu', variant: 'red' },
  };

  const { label, variant } = config[status] ?? { label: status, variant: 'gray' };
  return <Badge variant={variant}>{label}</Badge>;
}
