import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import { authApiService } from '../../services/auth.service';
import { commissionDisputeService } from '../../services/commissionDispute.service';
import { UserRole } from '@shared/types';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  badge?: number;
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const managerNavItems: NavItem[] = [
  {
    label: 'Tableau de bord',
    to: '/manager',
    icon: <NavIcon path="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  },
  {
    label: 'Paramétrage',
    to: '/manager/parametrage',
    icon: <NavIcon path="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
  },
  {
    label: 'Mon équipe',
    to: '/manager/team',
    icon: <NavIcon path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  },
  {
    label: 'Connexion CRM',
    to: '/manager/odoo',
    icon: <NavIcon path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
  },
  {
    label: 'Rapports de paie',
    to: '/manager/reports',
    icon: <NavIcon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  },
  {
    label: 'Facturation',
    to: '/manager/billing',
    icon: <NavIcon path="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />,
  },
];

// Nav équipe pour le Resp. de secteur (section gestion d'équipe)
const teamLeadManagerNavItems: NavItem[] = [
  {
    label: 'Tableau de bord équipe',
    to: '/manager',
    icon: <NavIcon path="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  },
  {
    label: 'Mon équipe',
    to: '/manager/team',
    icon: <NavIcon path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />,
  },
  {
    label: 'Paramétrage',
    to: '/manager/parametrage',
    icon: <NavIcon path="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
  },
];

// Nav personnelle pour le Resp. de secteur (section ses propres ventes)
const teamLeadPersonalNavItems: NavItem[] = [
  {
    label: 'Tableau de bord',
    to: '/dashboard',
    icon: <NavIcon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  },
  {
    label: 'Mes projections',
    to: '/dashboard/projections',
    icon: <NavIcon path="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
  },
];

const commercialNavItems: NavItem[] = [
  {
    label: 'Tableau de bord',
    to: '/dashboard',
    icon: <NavIcon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  },
  {
    label: 'Mes projections',
    to: '/dashboard/projections',
    icon: <NavIcon path="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
  },
];

const adminNavItems: NavItem[] = [
  {
    label: 'Clients (Tenants)',
    to: '/admin',
    icon: <NavIcon path="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  },
];

function NavList({ items }: { items: NavItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to.split('/').length <= 2}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
              )
            }
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-red-500 text-white">
                {item.badge}
              </span>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [openDisputeCount, setOpenDisputeCount] = useState(0);

  const isManager = user?.role === UserRole.MANAGER || user?.role === UserRole.TEAM_LEAD || user?.role === UserRole.BU_MANAGER;

  // Charger le compteur de contestations ouvertes pour les rôles manager
  useEffect(() => {
    if (!isManager) return;
    commissionDisputeService.listByTenant('OPEN')
      .then((disputes) => setOpenDisputeCount(disputes.length))
      .catch(() => {/* silencieux */});
  }, [isManager]);

  const isRespSecteur = user?.role === UserRole.TEAM_LEAD || user?.role === UserRole.BU_MANAGER;

  // Injecter le badge sur "Mon équipe"
  function withDisputeBadge(items: NavItem[]): NavItem[] {
    return items.map((item) =>
      item.to === '/manager/team' ? { ...item, badge: openDisputeCount } : item,
    );
  }

  const navItems =
    user?.role === UserRole.SUPER_ADMIN
      ? adminNavItems
      : user?.role === UserRole.MANAGER
        ? withDisputeBadge(managerNavItems)
        : isRespSecteur
          ? null // rendu spécial ci-dessous
          : commercialNavItems;

  const handleLogout = async () => {
    try {
      await authApiService.logout();
    } finally {
      logout();
      navigate('/login');
    }
  };

  return (
    <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-100">
        <img src="/logo.png" alt="Logo" className="h-8 w-auto object-contain" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {isRespSecteur ? (
          <div className="space-y-4">
            {/* Section équipe */}
            <div>
              <p className="px-3 mb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Mon équipe</p>
              <NavList items={withDisputeBadge(teamLeadManagerNavItems)} />
            </div>
            {/* Séparateur */}
            <div className="border-t border-gray-100" />
            {/* Section personnelle */}
            <div>
              <p className="px-3 mb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">Mon activité</p>
              <NavList items={teamLeadPersonalNavItems} />
            </div>
          </div>
        ) : (
          <NavList items={navItems ?? []} />
        )}
      </nav>

      {/* User info + logout */}
      <div className="px-3 py-4 border-t border-gray-100">
        {user && (
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
              <span className="text-primary-700 font-semibold text-xs">
                {user.firstName[0]}{user.lastName[0]}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={() => void handleLogout()}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <NavIcon path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          Se déconnecter
        </button>
      </div>
    </aside>
  );
}
