import { ROLES } from '@schroeder/shared';
import type { Me } from '@/lib/types';
import {
  ArrowLeftRight,
  CalendarDays,
  Clock,
  Droplets,
  House,
  Package,
  Settings,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  /** Short label for the narrow icon rail (iPad portrait). */
  short?: string;
  icon: LucideIcon;
  /** Exact match only (start pages), otherwise prefix match. */
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

type Features = Me['features'];

/** All areas of the app, grouped by role. A user with several roles sees several groups. */
export function navGroups(roles: string[], f: Features): NavGroup[] {
  const groups: NavGroup[] = [];
  if (roles.includes(ROLES.Monteur)) {
    groups.push({
      title: 'Monteur',
      items: [
        { href: '/monteur', label: 'Heute', icon: House, exact: true },
        { href: '/monteur/kalender', label: 'Kalender', icon: CalendarDays },
        ...(f.materials ? [{ href: '/monteur/artikel', label: 'Artikel', icon: Package }] : []),
        ...(f.stamping
          ? [{ href: '/monteur/zeiten', label: 'Meine Zeiten', short: 'Zeiten', icon: Clock }]
          : []),
        ...(f.materials
          ? [{ href: '/monteur/verbrauch', label: 'Öl & Diesel', short: 'Öl/Diesel', icon: Droplets }]
          : []),
        ...(f['productivity.self']
          ? [{ href: '/monteur/produktivitaet', label: 'Produktivität', short: 'Leistung', icon: TrendingUp }]
          : []),
      ],
    });
  }
  if (roles.includes(ROLES.Terminal)) {
    groups.push({
      title: 'Werkstatt-PC',
      items: [
        { href: '/terminal', label: 'Stempeln', icon: Clock, exact: true },
        { href: '/monteur/artikel', label: 'Artikel', icon: Package },
      ],
    });
  }
  if (roles.includes(ROLES.Lager)) {
    groups.push({
      title: 'Lager',
      items: [{ href: '/lager', label: 'Teiledienst', icon: Package }],
    });
  }
  if (roles.includes(ROLES.Admin)) {
    groups.push({
      title: 'Verwaltung',
      items: [
        { href: '/admin', label: 'Einstellungen', short: 'Admin', icon: Settings, exact: true },
        { href: '/admin/uebertragungen', label: 'Übertragungen BC', short: 'BC', icon: ArrowLeftRight },
      ],
    });
  }
  return groups;
}

export const isActive = (item: NavItem, path: string) =>
  item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
