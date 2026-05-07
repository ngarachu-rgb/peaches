export const ROLES = {
    DEVELOPER: 'developer',
    SYSTEM_ADMIN: 'system_admin',
    MANAGER: 'manager',
    SUPERVISOR: 'supervisor',
    CASHIER: 'cashier',
    CHEF: 'chef'
};

export const PERMISSIONS = {
    MANAGE_STAFF: 'manage_staff',
    MANAGE_ROLES: 'manage_roles',
    MANAGE_SYSTEM_SETTINGS: 'manage_system_settings',
    MANAGE_PRODUCTS: 'manage_products',
    MANAGE_RAW_MATERIALS: 'manage_raw_materials',
    MANAGE_RECIPES: 'manage_recipes',
    IMPORT_RAW_MATERIALS: 'import_raw_materials',
    RECEIVE_STOCK: 'receive_stock',
    POST_KITCHEN_OUTPUT: 'post_kitchen_output',
    RECORD_SALES: 'record_sales',
    RECORD_FINANCE: 'record_finance',
    CLOSE_SHIFT: 'close_shift',
    VIEW_SHIFT_REPORTS: 'view_shift_reports',
    VIEW_FINANCIAL_REPORTS: 'view_financial_reports',
    EXPORT_REPORTS: 'export_reports',
    DEVELOPER_TOOLS: 'developer_tools'
};

const ALL_PERMISSIONS = new Set(Object.values(PERMISSIONS));

const ROLE_PERMISSIONS = {
    [ROLES.DEVELOPER]: ALL_PERMISSIONS,
    [ROLES.SYSTEM_ADMIN]: new Set([
        PERMISSIONS.MANAGE_STAFF,
        PERMISSIONS.MANAGE_ROLES,
        PERMISSIONS.MANAGE_SYSTEM_SETTINGS,
        PERMISSIONS.MANAGE_PRODUCTS,
        PERMISSIONS.MANAGE_RAW_MATERIALS,
        PERMISSIONS.MANAGE_RECIPES,
        PERMISSIONS.IMPORT_RAW_MATERIALS,
        PERMISSIONS.RECEIVE_STOCK,
        PERMISSIONS.POST_KITCHEN_OUTPUT,
        PERMISSIONS.RECORD_SALES,
        PERMISSIONS.RECORD_FINANCE,
        PERMISSIONS.CLOSE_SHIFT,
        PERMISSIONS.VIEW_SHIFT_REPORTS,
        PERMISSIONS.VIEW_FINANCIAL_REPORTS,
        PERMISSIONS.EXPORT_REPORTS
    ]),
    [ROLES.MANAGER]: new Set([
        PERMISSIONS.MANAGE_PRODUCTS,
        PERMISSIONS.MANAGE_RAW_MATERIALS,
        PERMISSIONS.MANAGE_RECIPES,
        PERMISSIONS.IMPORT_RAW_MATERIALS,
        PERMISSIONS.RECEIVE_STOCK,
        PERMISSIONS.POST_KITCHEN_OUTPUT,
        PERMISSIONS.RECORD_SALES,
        PERMISSIONS.RECORD_FINANCE,
        PERMISSIONS.CLOSE_SHIFT,
        PERMISSIONS.VIEW_SHIFT_REPORTS,
        PERMISSIONS.VIEW_FINANCIAL_REPORTS,
        PERMISSIONS.EXPORT_REPORTS
    ]),
    [ROLES.SUPERVISOR]: new Set([
        PERMISSIONS.RECEIVE_STOCK,
        PERMISSIONS.POST_KITCHEN_OUTPUT,
        PERMISSIONS.RECORD_SALES,
        PERMISSIONS.RECORD_FINANCE,
        PERMISSIONS.CLOSE_SHIFT,
        PERMISSIONS.VIEW_SHIFT_REPORTS,
        PERMISSIONS.VIEW_FINANCIAL_REPORTS,
        PERMISSIONS.EXPORT_REPORTS
    ]),
    [ROLES.CASHIER]: new Set([
        PERMISSIONS.RECORD_SALES,
        PERMISSIONS.RECORD_FINANCE,
        PERMISSIONS.CLOSE_SHIFT,
        PERMISSIONS.VIEW_SHIFT_REPORTS,
        PERMISSIONS.EXPORT_REPORTS
    ]),
    [ROLES.CHEF]: new Set([
        PERMISSIONS.POST_KITCHEN_OUTPUT
    ])
};

export const PAGE_PERMISSIONS = {
    salesPage: PERMISSIONS.RECORD_SALES,
    financePage: PERMISSIONS.RECORD_FINANCE,
    kitchenPage: PERMISSIONS.POST_KITCHEN_OUTPUT,
    finishedProductsPage: PERMISSIONS.MANAGE_PRODUCTS,
    reportsPage: PERMISSIONS.VIEW_SHIFT_REPORTS,
    stocksPage: PERMISSIONS.RECEIVE_STOCK,
    storePage: PERMISSIONS.MANAGE_RAW_MATERIALS,
    matrixPage: PERMISSIONS.MANAGE_RECIPES,
    staffPage: PERMISSIONS.MANAGE_STAFF,
    accountPage: null,
    manualPage: null
};

const SUPERVISOR_VIEW_ONLY_PAGES = new Set([
    'finishedProductsPage',
    'storePage',
    'matrixPage'
]);

export function normalizeRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    const aliases = {
        admin: ROLES.SYSTEM_ADMIN,
        administrator: ROLES.SYSTEM_ADMIN,
        sys_admin: ROLES.SYSTEM_ADMIN,
        super_admin: ROLES.SYSTEM_ADMIN
    };
    const resolved = aliases[normalized] || normalized;
    return Object.values(ROLES).includes(resolved) ? resolved : '';
}

export function resolveLegacyRole(profile = {}) {
    const candidates = [
        profile?.role,
        profile?.user_role,
        profile?.access_role,
        profile?.position
    ];

    for (const candidate of candidates) {
        const normalized = normalizeRole(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return '';
}

export function resolvePermissions(role) {
    const normalizedRole = normalizeRole(role);
    return new Set(ROLE_PERMISSIONS[normalizedRole] || []);
}

export function hasPermission(permissions, permission) {
    if (!permission) return true;
    return permissions instanceof Set ? permissions.has(permission) : false;
}

export function hasPageAccess(role, permissions, pageId) {
    if (hasPermission(permissions, PAGE_PERMISSIONS[pageId])) {
        return true;
    }

    return normalizeRole(role) === ROLES.SUPERVISOR
        && SUPERVISOR_VIEW_ONLY_PAGES.has(pageId);
}

export function canSwitchBranches(role) {
    const normalizedRole = normalizeRole(role);
    return [
        ROLES.DEVELOPER,
        ROLES.SYSTEM_ADMIN,
        ROLES.MANAGER
    ].includes(normalizedRole);
}
