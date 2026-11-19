import type { AppStatus, Feature, Role } from '@schroeder/shared';

export interface Me {
  id: string;
  displayName: string;
  email: string;
  isApprentice: boolean;
  roles: Role[];
  grants: Array<{
    locationId: string;
    role: 'MONTEUR' | 'MEISTER' | 'LAGER';
    location?: { id: string; code: string; name: string };
  }>;
  bcResourceNo: string | null;
  features: Record<Feature, boolean>;
}

export interface Machine {
  id: string;
  brand: string;
  model: string;
  serialNo: string;
  operatingHours: number | null;
}

export interface OrderSummary {
  id: string;
  bcNo: string;
  description: string;
  orderTypeCode: string;
  appStatus: AppStatus;
  priority: string;
  responseDate: string | null;
  customerName: string;
  address: { street: string; postCode: string; city: string } | null;
  contactName: string;
  contactPhone: string;
  faultDescription: string;
  locationId: string;
  machines: Array<Machine | null>;
  assignments: Array<{ id: string; userId: string; plannedStart: string; plannedEnd: string }>;
}
