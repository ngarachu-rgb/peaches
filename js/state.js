export const DEFAULT_SHIFT_SYSTEM = 1;
export const DEFAULT_OPERATING_MODE = 'FOOD_PRODUCTION';

import { resolveLegacyRole, resolvePermissions } from './permissions.js';

export const state = {
    user: null,
    role: '',
    username: '',
    isActive: true,
    permissions: new Set(),
    restaurantId: null,
    assignedBranchId: null,
    branchId: null,
    useBranchScope: false,
    shiftSystem: DEFAULT_SHIFT_SYSTEM,
    operatingMode: DEFAULT_OPERATING_MODE,
    items: [],
    branches: [],
    rawMaterials: [],
    supplyItems: [],
    recipeMatrix: [],
    currentShiftTotal: 0,
    currentShift: null,
    shiftSeed: null,
    salesDrafts: {},
    financeDraft: {
        mpesaOpening: '',
        mpesaClosing: '',
        mpesaWithdraw: '',
        cashAtHand: '',
        notes: '',
        expenseLines: [],
        debtGivenLines: [],
        debtPaidLines: []
    },
    kitchenDrafts: [],
    stockReceiptDrafts: [],
    stockReceipts: [],
    supplyReceiptDrafts: [],
    supplyReceipts: [],
    stockTransfers: [],
    stockTransferDestinationBranchId: '',
    stockTransferDrafts: [],
    barStockIssues: [],
    barIssueDrafts: []
  };

function normalizeShiftSystemValue(value) {
    return Number(value) === 2 ? 2 : DEFAULT_SHIFT_SYSTEM;
}

function normalizeOperatingModeValue(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized === 'DIRECT_SALES' ? 'DIRECT_SALES' : DEFAULT_OPERATING_MODE;
}

export function setSessionContext(profile) {
    state.user = profile || null;
    state.role = resolveLegacyRole(profile);
    state.username = profile?.username || '';
    state.isActive = profile?.is_active !== false;
    state.permissions = resolvePermissions(state.role);
    state.restaurantId = profile?.restaurant_id || null;
    state.assignedBranchId = profile?.branch_id || profile?.default_branch_id || null;
    state.branchId = state.assignedBranchId;
    state.useBranchScope = Boolean(state.branchId);
    state.operatingMode = normalizeOperatingModeValue(profile?.operating_mode);

    const configuredShiftSystem = Number(
        profile?.shift_system ??
        profile?.shift_mode ??
        profile?.branch_shift_system ??
        DEFAULT_SHIFT_SYSTEM
    );

    state.shiftSystem = normalizeShiftSystemValue(configuredShiftSystem);
}

export function setShiftSystemFromBranch(branchId, branches = []) {
    const activeBranch = (branches || []).find((branch) => String(branch.id) === String(branchId || ''));
    if (!activeBranch) {
        return state.shiftSystem;
    }

    state.shiftSystem = normalizeShiftSystemValue(activeBranch.shift_system);
    return state.shiftSystem;
}

export function setOperatingModeFromBranch(branchId, branches = []) {
    const activeBranch = (branches || []).find((branch) => String(branch.id) === String(branchId || ''));
    if (!activeBranch) {
        return state.operatingMode;
    }

    const inferredMode = String(activeBranch.code || '').toUpperCase().includes('BAR')
        ? 'DIRECT_SALES'
        : DEFAULT_OPERATING_MODE;

    state.operatingMode = normalizeOperatingModeValue(activeBranch.operating_mode || inferredMode);
    return state.operatingMode;
}

export function getScope() {
    return {
        restaurantId: state.restaurantId,
        branchId: state.branchId,
        useBranchScope: state.useBranchScope,
        shiftSystem: state.shiftSystem,
        operatingMode: state.operatingMode
    };
}

export function resetAppState() {
    state.user = null;
    state.role = '';
    state.username = '';
    state.isActive = true;
    state.permissions = new Set();
    state.restaurantId = null;
    state.assignedBranchId = null;
    state.branchId = null;
    state.useBranchScope = false;
    state.shiftSystem = DEFAULT_SHIFT_SYSTEM;
    state.operatingMode = DEFAULT_OPERATING_MODE;
    state.items = [];
    state.branches = [];
    state.rawMaterials = [];
    state.supplyItems = [];
    state.recipeMatrix = [];
    state.currentShiftTotal = 0;
    state.currentShift = null;
    state.shiftSeed = null;
    state.salesDrafts = {};
    state.financeDraft = {
        mpesaOpening: '',
        mpesaClosing: '',
        mpesaWithdraw: '',
        cashAtHand: '',
        notes: '',
        expenseLines: [],
        debtGivenLines: [],
        debtPaidLines: []
      };
    state.kitchenDrafts = [];
    state.stockReceiptDrafts = [];
    state.stockReceipts = [];
    state.supplyReceiptDrafts = [];
    state.supplyReceipts = [];
    state.stockTransfers = [];
    state.stockTransferDestinationBranchId = '';
    state.stockTransferDrafts = [];
    state.barStockIssues = [];
    state.barIssueDrafts = [];
  }
