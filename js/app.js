import { buildAuthEmailCandidates, supabase } from './config.js';
import { state, getScope, resetAppState, setSessionContext, setShiftSystemFromBranch, setOperatingModeFromBranch } from './state.js';
import {
    calculateAccountedIncome,
    annotateShiftsForDisplay,
    calculateMpesaIncome,
    calculateSoldQty,
    calculateVariance,
    getCarryForwardBalances
} from './calculations.js';
import { PAGE_PERMISSIONS, PERMISSIONS, ROLES, canSwitchBranches, hasPageAccess, hasPermission } from './permissions.js';
import { createRepositories } from './repositories.js';
import { adjustReverseDispatch, closeShiftWithCarryForward, ensureActiveShift, recordReverseDispatch } from './shift-service.js';
import { transferRawMaterial } from './transfer-service.js';

const repositories = createRepositories(supabase);
window.supabase = supabase;
let rawImportRows = [];
let productImportRows = [];
let recipeImportRows = [];
let currentAuditReport = null;
let appToastTimer = null;
let idleLogoutInterval = null;
let idleMonitorBound = false;
let idleLogoutInProgress = false;
let lastUserActivityAt = 0;
const appModalState = {
    sourceId: '',
    sourceElement: null,
    placeholder: null,
    dismissHandler: null,
    mode: 'hosted'
};

const NAV_BUTTONS = {
    salesPage: 'navSales',
    kitchenPage: 'navKitchen',
    finishedProductsPage: 'navProducts',
    reportsPage: 'navReports',
    stocksPage: 'navStocks',
    storePage: 'navStore',
    matrixPage: 'navMatrix',
    staffPage: 'navStaff',
    accountPage: 'navAccount',
    manualPage: 'navManual'
};
const INVENTORY_PAGE_IDS = ['finishedProductsPage', 'storePage', 'matrixPage'];
let inventoryNavExpanded = false;
const OPERATION_MANUAL_SECTIONS = [
    {
        title: 'Logging In And Choosing A Branch',
        summary: 'How a user enters the app and confirms the correct branch and shift before working.',
        steps: [
            'Log in using your assigned username and password.',
            'Check the sidebar for the active branch, reporting date, and shift label before entering any data.',
            'If your role allows branch switching, use the branch selector and confirm you are in the correct branch before posting.',
            'If something looks wrong, stop first and confirm the branch and shift before receiving stock or entering sales.'
        ],
        keywords: ['login', 'branch', 'shift', 'sidebar', 'date', 'start']
    },
    {
        title: 'Receiving Items Into Stock',
        summary: 'How to receive raw items, drinks, and other stock into the current branch and shift.',
        steps: [
            'Open Stocks Page and stay on Receive Items.',
            'Choose the stock item, enter the received quantity, and enter the total received cost.',
            'Confirm the receipt total matches the supplier delivery note or invoice before posting.',
            'Click Record Receipts. The stock is added to store stock and the receipt appears in current-shift receipt history.'
        ],
        keywords: ['receive items', 'stock receipt', 'invoice', 'delivery', 'cost', 'stocks page']
    },
    {
        title: 'Receiving Operating Supplies',
        summary: 'How to receive non-production items such as soaps, towels, or other consumables.',
        steps: [
            'Open Stocks Page and switch to Receive Supplies.',
            'Start typing the supply name. Select an existing supply or keep typing to create a new one on save.',
            'Enter category, unit, quantity, cost, and any notes.',
            'Save the receipt. The item is stored separately from raw materials and can be reported later in finance reports.'
        ],
        keywords: ['supplies', 'soap', 'towels', 'consumables', 'receive supplies', 'operating supplies']
    },
    {
        title: 'Kitchen Production',
        summary: 'How restaurant branches convert raw materials into finished sale items through Kitchen Ops.',
        steps: [
            'Open Kitchen Ops and add the finished items produced during the shift.',
            'Enter the quantity produced for each item and post the batch.',
            'If one line fails, successful items are kept and removed from the draft while failed lines stay on screen for correction.',
            'Use the Adjust button in the production summary before closing the shift if a posted quantity needs correction. The app will reverse or add the matching raw material usage automatically.'
        ],
        keywords: ['kitchen ops', 'production', 'chef', 'produce', 'adjust', 'raw material usage']
    },
    {
        title: 'Restaurant Direct Sale Drinks',
        summary: 'How drinks like soda or juice sell directly from store without going through Kitchen Ops.',
        steps: [
            'A restaurant item sells directly from store when it is in category Drinks, has a matching raw/store item, and has no recipe rows.',
            'Such items appear in Daily Sales and are excluded from Kitchen Ops.',
            'Receive stock first so the item has store availability for the current branch.',
            'Enter the closing balance in Daily Sales like other direct-sale items.'
        ],
        keywords: ['restaurant drinks', 'direct sale', 'soda', 'juice', 'no kitchen', 'drinks']
    },
    {
        title: 'Bar Issue To Shots And Glasses',
        summary: 'How bar source bottles or packs are transferred into shots or glasses for sale.',
        steps: [
            'Open Stocks Page and switch to Issue To Shots.',
            'Choose the source stock item, the target finished product, and the issued quantity in source units such as 1 bottle or 1 box.',
            'Post the issue. Source store stock goes down and added stock increases on the target shot or glass item.',
            'Check the issue history if you need to confirm or reverse a current-shift mistake.'
        ],
        keywords: ['issue to shots', 'bar', 'glasses', 'source bottle', 'wine', 'measured sales']
    },
    {
        title: 'Daily Sales Entry',
        summary: 'How closing balances are entered so the app calculates sold quantities and totals.',
        steps: [
            'Open Daily Sales and confirm the branch, date, and shift at the top.',
            'Enter closing quantity or balance quantity for each visible item.',
            'The app calculates sold quantity and total sales automatically from opening, added, issues, and closing quantities.',
            'Rows with no opening stock and no additions are hidden automatically unless current logic makes them visible through direct stock availability.'
        ],
        keywords: ['daily sales', 'closing qty', 'sold qty', 'total sales', 'balance qty', 'cashier']
    },
    {
        title: 'Financial Reconciliation',
        summary: 'How to reconcile cash, M-Pesa, expenses, debts, and notes before closing a shift.',
        steps: [
            'Open Financial Reconciliation from Daily Sales when stock entry is complete.',
            'Enter M-Pesa opening, M-Pesa closing, withdrawals if any, and cash at hand.',
            'Add expense lines and debt lines where applicable.',
            'Use the reconciliation notes field for anything important that needs to be remembered in shift recall.',
            'Check the variance carefully. Negative variance means the cashier owes the company money.'
        ],
        keywords: ['finance', 'reconciliation', 'mpesa', 'cash', 'expenses', 'debts', 'variance', 'notes']
    },
    {
        title: 'Closing And Posting A Shift',
        summary: 'What happens when a shift is finalized and how to avoid common closing problems.',
        steps: [
            'Make sure all visible Daily Sales items have valid closing balances.',
            'Make sure finance values are entered and reviewed.',
            'Close the shift. The app saves inventory rows, finance totals, variance, and notes, then creates the next shift automatically.',
            'For two-shift branches, closing DAY should create NIGHT on the same business date. Closing NIGHT creates the next DAY on the next date.'
        ],
        keywords: ['close shift', 'posting', 'next shift', 'day night', 'full shift', 'finalize']
    },
    {
        title: 'Shift Recall And PDF Production',
        summary: 'How to inspect a closed shift later and export it as a PDF report.',
        steps: [
            'Open Reports & Audit, then use Shift Recall or Shift Reports.',
            'Choose the date range and open the exact shift you need.',
            'Review the summary cards and the item detail table showing opening, added, closing, sold, price, and total.',
            'Use Print PDF from the recall view when you need a printable record.'
        ],
        keywords: ['shift recall', 'reports', 'pdf', 'print', 'audit', 'history']
    },
    {
        title: 'Stock Transfer Between Branches',
        summary: 'How to move stock from one branch to another and what to verify after posting.',
        steps: [
            'Open Stocks Page and switch to Branch Stock Transfer.',
            'Choose the destination branch, item, and quantity to transfer.',
            'Post the transfer. The source stock goes down and the destination branch stock goes up.',
            'Use transfer history to confirm the movement or correct a current-shift mistake if necessary.'
        ],
        keywords: ['branch transfer', 'transfer history', 'move stock', 'destination branch', 'source branch']
    },
    {
        title: 'Adjustments And Corrections',
        summary: 'Which correction tools exist and when they should be used.',
        steps: [
            'Managers can adjust current store stock levels from Current Store Stock Levels.',
            'Managers can delete current-shift receipts, transfers, and issue-to-shots history entries to reverse mistakes safely.',
            'Kitchen production lines can be adjusted before shift close and the raw material stock is recalculated automatically.',
            'Deactivate an item instead of recreating a duplicate item when the same product should return later.'
        ],
        keywords: ['adjust stock', 'delete history', 'reverse', 'correction', 'deactivate', 'manager']
    },
    {
        title: 'Reports Worth Checking Regularly',
        summary: 'The most useful reports for managers and owners during daily control.',
        steps: [
            'Use Shift Reports for a quick list of closed shifts and their sales, M-Pesa, and variance.',
            'Use Financial Reports for raw items received, operating supplies, expenses, debt summaries, transfer history, and sales reports.',
            'Use Out of Stock Items to catch stock shortages early.',
            'Use raw consumption and kitchen-versus-sales reports to investigate unusual usage patterns.'
        ],
        keywords: ['financial reports', 'shift reports', 'out of stock', 'sales summary', 'variance detail', 'audit export']
    },
    {
        title: 'Good Daily Operating Habits',
        summary: 'Simple rules that reduce errors and make shift close easier.',
        steps: [
            'Always confirm the branch and shift before receiving stock or entering sales.',
            'Receive stock before selling it, and issue bar bottles to shots or glasses before selling measured items.',
            'Avoid creating duplicate items. Reactivate old items when it is the same product.',
            'Resolve obvious mistakes during the current shift instead of waiting until later.',
            'Use Shift Recall whenever sales or balances look wrong.'
        ],
        keywords: ['best practice', 'new user', 'training', 'mistakes', 'control', 'comfort']
    }
];

const SHOW_STARTUP_IMPORT_TOOLS = false;
const IDLE_LOGOUT_MS = 30 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;
const IDLE_ACTIVITY_EVENTS = ['click', 'keydown', 'input', 'change', 'focusin', 'pointerdown', 'mousedown', 'touchstart', 'touchmove', 'scroll'];

function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

function formatMoney(value) {
    return toNumber(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getActivePageId() {
    return document.querySelector('.page.active')?.id || '';
}

function setInventoryNavExpanded(expanded) {
    inventoryNavExpanded = expanded;
    const group = document.getElementById('navInventoryGroup');
    const toggle = document.getElementById('navInventoryToggle');
    if (group) {
        group.classList.toggle('hidden', !expanded);
    }
    if (toggle) {
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
}

function updateSidebarNavState(activePageId) {
    document.querySelectorAll('nav button').forEach((button) => {
        button.classList.remove('active', 'active-parent');
    });

    const activeButtonId = NAV_BUTTONS[activePageId];
    if (activeButtonId) {
        document.getElementById(activeButtonId)?.classList.add('active');
    }

    const onInventoryPage = INVENTORY_PAGE_IDS.includes(activePageId);
    const inventoryToggle = document.getElementById('navInventoryToggle');
    if (inventoryToggle) {
        inventoryToggle.classList.toggle('active-parent', onInventoryPage);
    }

    if (onInventoryPage) {
        setInventoryNavExpanded(true);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatQuantity(value, maximumFractionDigits = 2) {
    return toNumber(value).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits
    });
}

function normalizeSearchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function renderOperationManual(query = '') {
    const container = document.getElementById('manualContent');
    const status = document.getElementById('manualSearchStatus');
    if (!container || !status) return;

    const normalizedQuery = normalizeSearchText(query);
    const sections = OPERATION_MANUAL_SECTIONS.filter((section) => {
        if (!normalizedQuery) return true;
        const haystack = normalizeSearchText([
            section.title,
            section.summary,
            ...(section.steps || []),
            ...(section.keywords || [])
        ].join(' '));
        return haystack.includes(normalizedQuery);
    });

    status.innerText = normalizedQuery
        ? `${sections.length} section${sections.length === 1 ? '' : 's'} match "${query}".`
        : 'Type to filter the manual. Search works across section titles, steps, keywords, and notes.';

    if (!sections.length) {
        container.innerHTML = `
            <div class="manual-card" style="grid-column:1 / -1; text-align:center;">
                <h3 style="margin-bottom:6px;">No matching section found</h3>
                <p>Try a simpler search like <strong>sales</strong>, <strong>kitchen</strong>, <strong>receipt</strong>, <strong>variance</strong>, or <strong>pdf</strong>.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = sections.map((section) => `
        <section class="manual-card">
            <h3>${escapeHtml(section.title)}</h3>
            <p>${escapeHtml(section.summary)}</p>
            <ol>
                ${(section.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('')}
            </ol>
            <div class="manual-chip-row">
                ${(section.keywords || []).map((keyword) => `<span class="manual-chip">${escapeHtml(keyword)}</span>`).join('')}
            </div>
        </section>
    `).join('');
}

function hasMoreThanTwoDecimals(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value || !value.includes('.')) return false;
    return value.split('.')[1].length > 2;
}

function toDateOnly(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().split('T')[0];
}

function formatLongDate(value) {
    if (!value) return '--';
    return new Date(value).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function formatLongDateTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    const datePart = formatLongDate(date);
    const timePart = date.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    return `${datePart}, ${timePart}`;
}

function handleError(error, message = 'Something went wrong') {
    console.error(error);
    alert(error?.message || message);
}

function showAppToast(message, type = 'success') {
    const toast = document.getElementById('appToast');
    if (!toast) {
        alert(message);
        return;
    }

    if (appToastTimer) {
        clearTimeout(appToastTimer);
        appToastTimer = null;
    }

    toast.innerText = String(message || '').trim() || 'Done.';
    toast.className = `app-toast ${type}`;

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    appToastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2400);
}

function clearIdleTimers() {
    if (idleLogoutInterval) {
        clearInterval(idleLogoutInterval);
        idleLogoutInterval = null;
    }
}

function markUserActivity() {
    if (!state.user?.id || idleLogoutInProgress) return;
    lastUserActivityAt = Date.now();
}

async function checkIdleLogout() {
    if (!state.user?.id || idleLogoutInProgress || !lastUserActivityAt) return;
    if ((Date.now() - lastUserActivityAt) < IDLE_LOGOUT_MS) return;

    idleLogoutInProgress = true;
    stopIdleLogoutMonitor();
    await window.handleLogout(true);
}

function stopIdleLogoutMonitor() {
    clearIdleTimers();

    if (idleMonitorBound) {
        IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
            document.removeEventListener(eventName, markUserActivity, true);
        });
        window.removeEventListener('focus', markUserActivity, true);
        idleMonitorBound = false;
    }
}

function startIdleLogoutMonitor() {
    stopIdleLogoutMonitor();
    idleLogoutInProgress = false;
    lastUserActivityAt = Date.now();

    IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
        document.addEventListener(eventName, markUserActivity, true);
    });
    window.addEventListener('focus', markUserActivity, true);

    idleMonitorBound = true;
    idleLogoutInterval = setInterval(() => {
        checkIdleLogout().catch((error) => console.error('Idle logout failed', error));
    }, IDLE_CHECK_INTERVAL_MS);
}

function getAppModalElements() {
    return {
        wrap: document.getElementById('appModal'),
        title: document.getElementById('appModalTitle'),
        body: document.getElementById('appModalBody')
    };
}

function hideAppModal() {
    const { wrap, body } = getAppModalElements();
    if (body) body.innerHTML = '';
    if (wrap) {
        wrap.classList.add('hidden');
        wrap.style.display = 'none';
    }
    appModalState.sourceId = '';
    appModalState.sourceElement = null;
    appModalState.placeholder = null;
    appModalState.dismissHandler = null;
    appModalState.mode = 'hosted';
}

function closeAppModalImmediate() {
    const { body } = getAppModalElements();

    if (appModalState.mode === 'hosted' && appModalState.sourceElement && appModalState.placeholder?.parentNode) {
        appModalState.placeholder.parentNode.insertBefore(appModalState.sourceElement, appModalState.placeholder);
        appModalState.placeholder.remove();
    }

    if (body) body.innerHTML = '';
    hideAppModal();
}

function openHostedModal(title, sourceId, dismissHandler = null) {
    const { wrap, title: titleNode, body } = getAppModalElements();
    const sourceElement = document.getElementById(sourceId);
    if (!wrap || !titleNode || !body || !sourceElement) return;

    closeAppModalImmediate();

    const placeholder = document.createElement('div');
    placeholder.dataset.modalPlaceholderFor = sourceId;
    sourceElement.parentNode?.insertBefore(placeholder, sourceElement);
    body.appendChild(sourceElement);

    titleNode.innerText = title || 'Edit';
    wrap.classList.remove('hidden');
    wrap.style.display = 'flex';

    appModalState.sourceId = sourceId;
    appModalState.sourceElement = sourceElement;
    appModalState.placeholder = placeholder;
    appModalState.dismissHandler = dismissHandler;
    appModalState.mode = 'hosted';

    const firstField = sourceElement.querySelector('input, select, textarea, button');
    if (firstField instanceof HTMLElement) {
        setTimeout(() => firstField.focus(), 0);
    }
}

function openPromptModal({
    title,
    label,
    initialValue = '',
    inputType = 'number',
    inputStep = '0.01',
    placeholder = '',
    confirmText = 'Save'
}) {
    const { wrap, title: titleNode, body } = getAppModalElements();
    if (!wrap || !titleNode || !body) {
        return Promise.resolve(null);
    }

    closeAppModalImmediate();
    titleNode.innerText = title || 'Adjust';
    wrap.classList.remove('hidden');
    wrap.style.display = 'flex';
    appModalState.mode = 'prompt';

    return new Promise((resolve) => {
        const inputId = `appModalInput_${Date.now()}`;
        const confirm = () => {
            const value = document.getElementById(inputId)?.value ?? '';
            closeAppModalImmediate();
            resolve(String(value));
        };
        const cancel = () => {
            closeAppModalImmediate();
            resolve(null);
        };

        appModalState.dismissHandler = cancel;

        body.innerHTML = `
            <div style="display:grid; gap:14px;">
                <label for="${inputId}" style="font-size:13px; color:#475569; font-weight:600;">${label}</label>
                <input id="${inputId}" type="${inputType}" step="${inputStep}" value="${escapeHtml(initialValue)}" placeholder="${escapeHtml(placeholder)}" style="padding:12px; border:1px solid #cbd5e1; border-radius:10px;">
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button type="button" class="btn" id="appModalCancelBtn" style="background:#e2e8f0; color:#334155;">Cancel</button>
                    <button type="button" class="btn btn-success" id="appModalConfirmBtn">${confirmText}</button>
                </div>
            </div>
        `;

        document.getElementById('appModalCancelBtn')?.addEventListener('click', cancel);
        document.getElementById('appModalConfirmBtn')?.addEventListener('click', confirm);
        const input = document.getElementById(inputId);
        if (input) {
            setTimeout(() => {
                input.focus();
                if (input.select) input.select();
            }, 0);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    confirm();
                }
                if (event.key === 'Escape') {
                    event.preventDefault();
                    cancel();
                }
            });
        }
    });
}

function getDraftedClosingQty(productId, fallback = 0) {
    const draftValue = state.salesDrafts?.[String(productId)];
    return draftValue === undefined ? toNumber(fallback) : toNumber(draftValue);
}

function hasExplicitClosingDraft(productId) {
    return Object.prototype.hasOwnProperty.call(state.salesDrafts || {}, String(productId));
}

function isDirectSalesMode() {
    return state.operatingMode === 'DIRECT_SALES';
}

function getDefaultRecipeCategory() {
    return isDirectSalesMode() ? 'Bottled & Canned' : 'Food';
}

function getAvailableProductCategories() {
    const categories = new Set(
        (state.items || [])
            .map((item) => String(item.category || '').trim())
            .filter(Boolean)
    );

    if (!categories.size) {
        return isDirectSalesMode()
            ? ['Bottled & Canned', 'Shots', 'Glasses', 'Cocktails']
            : ['Food', 'Drinks', 'Snacks'];
    }

    return Array.from(categories).sort((left, right) => left.localeCompare(right));
}

function refreshRecipeCategoryOptions(selectedValue = '') {
    const categorySelect = document.getElementById('productCategory');
    if (!categorySelect) return;

    const categories = getAvailableProductCategories();
    const preferredValue = selectedValue || categorySelect.value || getDefaultRecipeCategory();
    const fallbackValue = categories.includes(preferredValue) ? preferredValue : (categories[0] || getDefaultRecipeCategory());

    categorySelect.innerHTML = categories.map((category) => (
        `<option value="${category}" ${category === fallbackValue ? 'selected' : ''}>${category}</option>`
    )).join('');
}

function refreshFinishedProductCategoryOptions(selectedValue = '') {
    const categorySelect = document.getElementById('pCat');
    if (!categorySelect) return;

    const categories = getAvailableProductCategories();
    const preferredValue = selectedValue || categorySelect.value || getDefaultRecipeCategory();
    const fallbackValue = categories.includes(preferredValue) ? preferredValue : (categories[0] || getDefaultRecipeCategory());

    categorySelect.innerHTML = categories.map((category) => (
        `<option value="${category}" ${category === fallbackValue ? 'selected' : ''}>${category}</option>`
    )).join('');
}

function stripEntityCodePrefix(value) {
    const rawValue = String(value || '').trim();
    const separator = ' - ';
    const separatorIndex = rawValue.indexOf(separator);
    return separatorIndex === -1 ? rawValue : rawValue.slice(separatorIndex + separator.length).trim();
}

function normalizeEntityName(value) {
    return stripEntityCodePrefix(value).trim().toLowerCase();
}

function entityNamesMatch(left, right) {
    const normalizedLeft = normalizeEntityName(left);
    const normalizedRight = normalizeEntityName(right);
    return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
}

function isMeasuredRecipeProductName(value) {
    return /(?:^|\s)(30\s*ml|150\s*ml|glass)(?:$|\s)/i.test(String(value || '').trim());
}

function createExpenseDraft() {
    return {
        description: '',
        qty: '',
        unitCost: '',
        notes: ''
    };
}

function createDebtDraft() {
    return {
        clientName: '',
        phone: '',
        amount: '',
        notes: ''
    };
}

function createStockReceiptDraft() {
    return {
        materialId: '',
        materialSearch: '',
        qty: '',
        totalReceivedCost: ''
    };
}

function createSupplyReceiptDraft() {
    return {
        supplyItemId: '',
        itemSearch: '',
        category: '',
        buyUnit: '',
        qty: '',
        totalReceivedCost: '',
        notes: ''
    };
}

function createStockTransferDraft() {
    return {
        materialId: '',
        materialSearch: '',
        qty: '',
        notes: ''
    };
}

function createBarIssueDraft() {
    return {
        sourceMaterialId: '',
        sourceMaterialSearch: '',
        targetProductId: '',
        targetProductSearch: '',
        qty: '',
        notes: ''
    };
}

function ensureFinanceDrafts() {
    if (!Array.isArray(state.financeDraft?.expenseLines) || !state.financeDraft.expenseLines.length) {
        state.financeDraft.expenseLines = [createExpenseDraft()];
    }
    if (!Array.isArray(state.financeDraft?.debtGivenLines) || !state.financeDraft.debtGivenLines.length) {
        state.financeDraft.debtGivenLines = [createDebtDraft()];
    }
    if (!Array.isArray(state.financeDraft?.debtPaidLines) || !state.financeDraft.debtPaidLines.length) {
        state.financeDraft.debtPaidLines = [createDebtDraft()];
    }
}

function ensureStockReceiptDrafts() {
    if (!Array.isArray(state.stockReceiptDrafts) || !state.stockReceiptDrafts.length) {
        state.stockReceiptDrafts = [createStockReceiptDraft()];
    }
}

function ensureSupplyReceiptDrafts() {
    if (!Array.isArray(state.supplyReceiptDrafts) || !state.supplyReceiptDrafts.length) {
        state.supplyReceiptDrafts = [createSupplyReceiptDraft()];
    }
}

function ensureStockTransferDrafts() {
    if (!Array.isArray(state.stockTransferDrafts) || !state.stockTransferDrafts.length) {
        state.stockTransferDrafts = [createStockTransferDraft()];
    }
}

function ensureBarIssueDrafts() {
    if (!Array.isArray(state.barIssueDrafts) || !state.barIssueDrafts.length) {
        state.barIssueDrafts = [createBarIssueDraft()];
    }
}

if (!window.__numberInputWheelGuardBound) {
    window.__numberInputWheelGuardBound = true;
    document.addEventListener('wheel', (event) => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLInputElement && activeElement.type === 'number') {
            event.preventDefault();
        }
    }, { passive: false });
}

function getExpenseLineAmount(line) {
    return toNumber(line.qty) * toNumber(line.unitCost);
}

function getExpenseLines() {
    ensureFinanceDrafts();
    return state.financeDraft.expenseLines
        .map((line) => ({
            description: String(line.description || '').trim(),
            qty: toNumber(line.qty),
            unitCost: toNumber(line.unitCost),
            amount: getExpenseLineAmount(line),
            notes: String(line.notes || '').trim()
        }))
        .filter((line) => line.description || line.qty > 0 || line.unitCost > 0 || line.notes);
}

function getDebtLines(type) {
    ensureFinanceDrafts();
    const lines = type === 'paid' ? state.financeDraft.debtPaidLines : state.financeDraft.debtGivenLines;
    return lines
        .map((line) => ({
            clientName: String(line.clientName || '').trim(),
            phone: String(line.phone || '').trim(),
            amount: toNumber(line.amount),
            notes: String(line.notes || '').trim()
        }))
        .filter((line) => line.clientName || line.phone || line.amount > 0 || line.notes);
}

function calculateFinanceLineTotals() {
    const expenseLines = getExpenseLines();
    const debtGivenLines = getDebtLines('given');
    const debtPaidLines = getDebtLines('paid');

    return {
        expenseLines,
        debtGivenLines,
        debtPaidLines,
        totalExpenses: expenseLines.reduce((sum, line) => sum + getExpenseLineAmount(line), 0),
        totalDebtGiven: debtGivenLines.reduce((sum, line) => sum + toNumber(line.amount), 0),
        totalDebtPaid: debtPaidLines.reduce((sum, line) => sum + toNumber(line.amount), 0)
    };
}

function syncFinanceDraftFromDom() {
    ensureFinanceDrafts();
    state.financeDraft = {
        mpesaOpening: document.getElementById('mpesaOpening')?.value || '',
        mpesaClosing: document.getElementById('mpesaClosing')?.value || '',
        mpesaWithdraw: document.getElementById('mpesaWithdraw')?.value || '',
        cashAtHand: document.getElementById('cashAtHand')?.value || '',
        notes: document.getElementById('financeNotes')?.value || '',
        expenseLines: state.financeDraft.expenseLines,
        debtGivenLines: state.financeDraft.debtGivenLines,
        debtPaidLines: state.financeDraft.debtPaidLines
    };
}

function autoResizeTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 42)}px`;
}

function setRawImportStatus(message, isError = false) {
    const status = document.getElementById('rawImportStatus');
    if (!status) return;
    status.innerText = message;
    status.style.color = isError ? '#dc2626' : '#64748b';
}

function setAuditReportStatus(message, isError = false) {
    const status = document.getElementById('auditReportStatus');
    if (!status) return;
    status.innerText = message;
    status.style.color = isError ? '#dc2626' : '#64748b';
}

function prettifyRole(role) {
    return String(role || '')
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || '--';
}

function getProfileDisplayName(profile) {
    return profile?.full_name || profile?.name || profile?.username || profile?.email || profile?.id || '--';
}

function formatBranchDisplayName(branch) {
    if (!branch) return '--';
    const branchCode = String(branch.code || '').trim().toUpperCase();
    const branchName = String(branch.name || '').trim();

    if (branchCode === 'TSAVO' && (!branchName || /tsavo/i.test(branchName))) {
        return 'Peaches';
    }

    return branchName || branch.code || '--';
}

function getBranchLabel(branchId) {
    const branch = (state.branches || []).find((entry) => String(entry.id) === String(branchId));
    if (!branch) return '--';
    return formatBranchDisplayName(branch);
}

function populateStaffBranchOptions(selectedBranchId = '') {
    const branchSelect = document.getElementById('staffBranch');
    if (!branchSelect) return;

    const branchOptions = (state.branches || [])
        .filter((branch) => branch.is_active !== false)
        .map((branch) => `<option value="${branch.id}" ${String(branch.id) === String(selectedBranchId || '') ? 'selected' : ''}>${formatBranchDisplayName(branch)}</option>`)
        .join('');

    branchSelect.innerHTML = branchOptions || '<option value="">No branches available</option>';
}

function requirePermission(permission, message = 'You do not have permission to perform this action.') {
    if (!hasPermission(state.permissions, permission)) {
        throw new Error(message);
    }
}

function canAccessPage(pageId) {
    if (pageId === 'kitchenPage' && state.operatingMode === 'DIRECT_SALES') {
        return false;
    }
    return hasPageAccess(state.role, state.permissions, pageId);
}

function isSupervisorReadOnlyMasterPage(pageId) {
    return state.role === ROLES.SUPERVISOR
        && ['finishedProductsPage', 'storePage', 'matrixPage'].includes(pageId);
}

function applyMasterPageModes() {
    const canManageProducts = hasPermission(state.permissions, PERMISSIONS.MANAGE_PRODUCTS);
    const canManageRawMaterials = hasPermission(state.permissions, PERMISSIONS.MANAGE_RAW_MATERIALS);
    const canImportRawMaterials = hasPermission(state.permissions, PERMISSIONS.IMPORT_RAW_MATERIALS);
    const canManageRecipes = hasPermission(state.permissions, PERMISSIONS.MANAGE_RECIPES);

    const finishedProductsFormCard = document.getElementById('finishedProductsFormCard');
    const finishedImportCard = document.getElementById('finishedImportCard');
    const rawMaterialFormCard = document.getElementById('rawMaterialFormCard');
    const rawImportCard = document.getElementById('rawImportCard');
    const matrixEditorCard = document.getElementById('managerOnlyMatrix');
    const matrixImportCard = document.getElementById('matrixImportCard');

    if (finishedProductsFormCard) {
        finishedProductsFormCard.classList.toggle('hidden', !canManageProducts);
        if (!canManageProducts) window.resetProductForm();
    }

    if (finishedImportCard) {
        finishedImportCard.classList.toggle('hidden', !canManageProducts || !SHOW_STARTUP_IMPORT_TOOLS);
    }

    if (rawMaterialFormCard) {
        rawMaterialFormCard.classList.toggle('hidden', !canManageRawMaterials);
        if (!canManageRawMaterials) window.resetRawForm();
    }

    if (rawImportCard) {
        rawImportCard.classList.toggle('hidden', !canImportRawMaterials || !SHOW_STARTUP_IMPORT_TOOLS);
    }

    if (matrixEditorCard) {
        matrixEditorCard.classList.toggle('hidden', !canManageRecipes);
        if (!canManageRecipes) window.resetRecipeForm();
    }

    if (matrixImportCard) {
        matrixImportCard.classList.toggle('hidden', !canManageRecipes || !SHOW_STARTUP_IMPORT_TOOLS);
    }
}

function resetBranchScopedDrafts() {
    state.currentShiftTotal = 0;
    state.currentShift = null;
    state.shiftSeed = null;
    state.keyStoreChecks = [];
    state.keyStoreCheckDrafts = {};
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
    state.stockTransfers = [];
    state.supplyItems = [];
    state.supplyReceiptDrafts = [];
    state.supplyReceipts = [];
    state.stockTransferDestinationBranchId = '';
    state.stockTransferDrafts = [];
    currentAuditReport = null;
}

function updateBranchSwitcher() {
    const wrap = document.getElementById('branchSwitcherWrap');
    const select = document.getElementById('branchSwitcher');
    if (!wrap || !select) return;

    const activeBranches = (state.branches || []).filter((branch) => branch.is_active !== false);
    const branchName = getCurrentBranchName();
    const canSwitch = canSwitchBranches(state.role);

    wrap.classList.toggle('hidden', !activeBranches.length);
    const options = activeBranches.map((branch) => `
        <option value="${branch.id}" ${String(branch.id) === String(state.branchId || '') ? 'selected' : ''}>
            ${formatBranchDisplayName(branch)}
        </option>
    `).join('');

    select.innerHTML = options || '<option value="">No branches available</option>';
    select.disabled = !canSwitch;
    select.style.display = canSwitch ? 'block' : 'none';
}

function syncShiftSystemWithActiveBranch() {
    const currentBranchId = state.branchId || state.assignedBranchId || state.user?.branch_id || state.user?.default_branch_id || '';
    setShiftSystemFromBranch(currentBranchId, state.branches || []);
}

function updateReportScopeControls() {
    const wrap = document.getElementById('reportScopeWrap');
    const select = document.getElementById('reportScope');
    if (!wrap || !select) return;

    const visible = canSwitchBranches(state.role);
    wrap.classList.toggle('hidden', !visible);
    if (!visible) {
        select.value = 'current';
    }
}

function getReportScope() {
    const reportScopeValue = document.getElementById('reportScope')?.value || 'current';
    if (canSwitchBranches(state.role) && reportScopeValue === 'all') {
        return {
            ...getScope(),
            useBranchScope: false
        };
    }

    return getScope();
}

function isAllBranchesReportScope() {
    return canSwitchBranches(state.role)
        && (document.getElementById('reportScope')?.value || 'current') === 'all';
}

function applyRoleAccess() {
    Object.entries(NAV_BUTTONS).forEach(([pageId, buttonId]) => {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.classList.toggle('hidden', !canAccessPage(pageId));
    });

    const inventoryToggle = document.getElementById('navInventoryToggle');
    const inventoryGroup = document.getElementById('navInventoryGroup');
    const hasInventoryAccess = INVENTORY_PAGE_IDS.some((pageId) => canAccessPage(pageId));
    if (inventoryToggle) {
        inventoryToggle.classList.toggle('hidden', !hasInventoryAccess);
    }
    if (inventoryGroup) {
        inventoryGroup.classList.toggle('hidden', !hasInventoryAccess || !inventoryNavExpanded);
    }

    const financialButton = document.getElementById('btnFinancialReports');
    if (financialButton) {
        financialButton.classList.toggle('hidden', !hasPermission(state.permissions, PERMISSIONS.VIEW_FINANCIAL_REPORTS));
    }

    const issuesButton = document.getElementById('stocksViewIssuesBtn');
    if (issuesButton) {
        issuesButton.classList.toggle('hidden', !isDirectSalesMode());
    }

    updateBranchSwitcher();
    updateReportScopeControls();
    applyMasterPageModes();
    updateShiftStatusPanel();
}

function populateAccountPage() {
    const fullName = document.getElementById('accountFullName');
    const username = document.getElementById('accountUsername');
    const role = document.getElementById('accountRole');
    if (fullName) fullName.innerText = getProfileDisplayName(state.user);
    if (username) username.innerText = state.username || '--';
    if (role) role.innerText = prettifyRole(state.role);
}

function updateSidebarUserSummary() {
    const nameNode = document.getElementById('sidebarUserName');
    const roleNode = document.getElementById('sidebarUserRole');
    if (!nameNode || !roleNode) return;

    nameNode.innerText = getProfileDisplayName(state.user);
    roleNode.innerText = prettifyRole(state.role || '--');
}

function updatePageBranchLabels() {
    const branchName = getCurrentBranchName();
    document.querySelectorAll('.page h2').forEach((heading) => {
        let badge = heading.querySelector('.page-branch-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'page-branch-badge';
            heading.appendChild(badge);
        }

        heading.style.display = 'flex';
        heading.style.alignItems = 'center';
        heading.style.gap = '10px';
        heading.style.flexWrap = 'wrap';

        badge.innerText = branchName;
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.padding = '6px 12px';
        badge.style.borderRadius = '999px';
        badge.style.background = '#eff6ff';
        badge.style.color = '#1d4ed8';
        badge.style.fontSize = '13px';
        badge.style.fontWeight = '800';
        badge.style.textTransform = 'uppercase';
        badge.style.letterSpacing = '0.04em';
    });
}

function getDefaultPage() {
    const preferredPages = [
        'salesPage',
        'kitchenPage',
        'reportsPage',
        'storePage',
        'finishedProductsPage',
        'accountPage'
    ];

    return preferredPages.find((pageId) => canAccessPage(pageId)) || 'accountPage';
}

function syncOperatingModeWithActiveBranch() {
    setOperatingModeFromBranch(state.branchId, state.branches);
}

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            index += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current.trim());
    return values;
}

function parseCsvText(text) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('CSV must include a header row and at least one data row.');
    }

    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
    return lines.slice(1).map((line, rowIndex) => {
        const values = parseCsvLine(line);
        const row = {};
        headers.forEach((header, headerIndex) => {
            row[header] = values[headerIndex] ?? '';
        });
        row.__rowNumber = rowIndex + 2;
        return row;
    });
}

function normalizeRawImportRows(rows, restaurantIdOverride = '') {
    return rows.map((row) => {
        const itemCode = (row.item_code || row.code || '').trim().toUpperCase();
        const baseName = row.name?.trim() || '';
        const storedName = itemCode ? `${itemCode} - ${baseName}` : baseName;
        const normalized = {
            item_code: itemCode,
            base_name: baseName,
            name: storedName,
            buy_unit: row.buy_unit?.trim() || '',
            store_unit: row.store_unit?.trim() || '',
            conversion_factor: Number(row.conversion_factor),
            price: Number(row.price),
            restaurant_id: (row.restaurant_id || restaurantIdOverride || state.restaurantId || '').trim()
        };

        if (!normalized.base_name) {
            throw new Error(`Row ${row.__rowNumber}: name is required.`);
        }
        if (!normalized.buy_unit) {
            throw new Error(`Row ${row.__rowNumber}: buy_unit is required.`);
        }
        if (!normalized.store_unit) {
            throw new Error(`Row ${row.__rowNumber}: store_unit is required.`);
        }
        if (!Number.isFinite(normalized.conversion_factor) || normalized.conversion_factor <= 0) {
            throw new Error(`Row ${row.__rowNumber}: conversion_factor must be greater than 0.`);
        }
        if (!Number.isFinite(normalized.price) || normalized.price < 0) {
            throw new Error(`Row ${row.__rowNumber}: price must be 0 or more.`);
        }
        if (!normalized.restaurant_id) {
            throw new Error(`Row ${row.__rowNumber}: restaurant_id is required.`);
        }

        return normalized;
    });
}

function normalizeProductImportRows(rows, restaurantIdOverride = '') {
    return rows.map((row) => {
        const name = (row.item_name || row.name || '').trim();
        const category = (row.category || '').trim() || 'Drinks';
        const rawPrice = row.price ?? row.sale_price ?? '';
        const price = rawPrice === '' ? 0 : Number(rawPrice);
        const restaurantId = (row.restaurant_id || restaurantIdOverride || state.restaurantId || '').trim();

        if (!name) {
            throw new Error(`Row ${row.__rowNumber}: item_name or name is required.`);
        }
        if (!category) {
            throw new Error(`Row ${row.__rowNumber}: category is required.`);
        }
        if (!Number.isFinite(price) || price < 0) {
            throw new Error(`Row ${row.__rowNumber}: price must be 0 or more.`);
        }
        if (!restaurantId) {
            throw new Error(`Row ${row.__rowNumber}: restaurant_id is required.`);
        }

        return {
            name,
            category,
            price,
            restaurant_id: restaurantId
        };
    });
}

function normalizeRecipeImportRows(rows, restaurantIdOverride = '') {
    return rows.map((row) => {
        const finishedItemName = (row.finished_item_name || row.product || '').trim();
        const materialName = (row.material_name || row.ingredient || '').trim();
        const qtyPerUnit = Number(row.qty_per_unit ?? row.qty ?? row.quantity);
        const restaurantId = (row.restaurant_id || restaurantIdOverride || state.restaurantId || '').trim();

        if (!finishedItemName) {
            throw new Error(`Row ${row.__rowNumber}: finished_item_name is required.`);
        }
        if (!materialName) {
            throw new Error(`Row ${row.__rowNumber}: material_name is required.`);
        }
        if (!Number.isFinite(qtyPerUnit) || qtyPerUnit <= 0) {
            throw new Error(`Row ${row.__rowNumber}: qty_per_unit must be greater than 0.`);
        }
        if (!restaurantId) {
            throw new Error(`Row ${row.__rowNumber}: restaurant_id is required.`);
        }

        return {
            finished_item_name: finishedItemName,
            material_name: materialName,
            qty_per_unit: qtyPerUnit,
            restaurant_id: restaurantId
        };
    });
}

function composeMaterialName(code, name) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const normalizedName = String(name || '').trim();
    return normalizedCode ? `${normalizedCode} - ${normalizedName}` : normalizedName;
}

function splitMaterialName(storedName) {
    const rawValue = String(storedName || '').trim();
    const separator = ' - ';
    const separatorIndex = rawValue.indexOf(separator);

    if (separatorIndex === -1) {
        return { code: '', name: rawValue };
    }

    return {
        code: rawValue.slice(0, separatorIndex).trim(),
        name: rawValue.slice(separatorIndex + separator.length).trim()
    };
}

function escapeOptionValue(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderRawMaterialNameSuggestions() {
    const datalist = document.getElementById('rawNameSuggestions');
    if (!datalist) return;

    const uniqueNames = Array.from(new Set(
        (state.rawMaterials || [])
            .map((material) => splitMaterialName(material.name).name)
            .map((name) => String(name || '').trim())
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    datalist.innerHTML = uniqueNames
        .map((name) => `<option value="${escapeOptionValue(name)}"></option>`)
        .join('');
}

function updateRawMaterialNameHint() {
    const hint = document.getElementById('rawNameHint');
    const input = document.getElementById('rawName');
    const idField = document.getElementById('rawMaterialId');
    if (!hint || !input || !idField) return;

    const typedName = String(input.value || '').trim().toLowerCase();
    const editingId = String(idField.value || '');

    if (!typedName) {
        hint.innerText = '';
        hint.style.color = '#64748b';
        return;
    }

    const existingMatch = (state.rawMaterials || []).find((material) => {
        if (editingId && String(material.id) === editingId) return false;
        return splitMaterialName(material.name).name.trim().toLowerCase() === typedName;
    });

    if (existingMatch) {
        const splitName = splitMaterialName(existingMatch.name);
        hint.innerText = splitName.code
            ? `Existing item found: ${splitName.code} - ${splitName.name}`
            : `Existing item found: ${splitName.name}`;
        hint.style.color = '#b45309';
        return;
    }

    hint.innerText = 'No exact existing material name match found.';
    hint.style.color = '#64748b';
}

function getDisplayMaterialName(storedName) {
    return splitMaterialName(storedName).name || String(storedName || '').trim();
}

function findRawMaterialByDisplayName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;

    return state.rawMaterials.find((material) => {
        const storedName = String(material.name || '').trim().toLowerCase();
        const displayName = getDisplayMaterialName(material.name).trim().toLowerCase();
        return storedName === normalized || displayName === normalized;
    }) || null;
}

function getDisplaySupplyItemName(storedName) {
    return stripEntityCodePrefix(storedName).trim();
}

function findSupplyItemByDisplayName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;

    return (state.supplyItems || []).find((item) => {
        const storedName = String(item.name || '').trim().toLowerCase();
        const displayName = getDisplaySupplyItemName(item.name).trim().toLowerCase();
        return storedName === normalized || displayName === normalized;
    }) || null;
}

function getSupplyCategories() {
    const categories = Array.from(new Set(
        (state.supplyItems || [])
            .map((item) => String(item.category || '').trim())
            .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right));

    return categories.length
        ? categories
        : ['Cleaning', 'Consumables', 'Packaging', 'Guest Supplies', 'Admin Supplies', 'General Supplies'];
}

function splitProductName(storedName) {
    const rawValue = String(storedName || '').trim();
    const separator = ' - ';
    const separatorIndex = rawValue.indexOf(separator);

    if (separatorIndex === -1) {
        return { code: '', name: rawValue };
    }

    return {
        code: rawValue.slice(0, separatorIndex).trim(),
        name: rawValue.slice(separatorIndex + separator.length).trim()
    };
}

function getDisplayProductName(storedName) {
    return splitProductName(storedName).name || String(storedName || '').trim();
}

function findProductByDisplayName(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;

    return state.items.find((item) => {
        const storedName = String(item.name || '').trim().toLowerCase();
        const displayName = getDisplayProductName(item.name).trim().toLowerCase();
        return storedName === normalized || displayName === normalized;
    }) || null;
}

function formatDateDisplay(value) {
    if (!value) return '';
    return formatLongDate(value);
}

function formatDateTimeDisplay(value) {
    if (!value) return '';
    return formatLongDateTime(value);
}

function escapeCsvValue(value) {
    const stringValue = String(value ?? '');
    if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

function downloadCsv(filename, columns, rows) {
    const header = columns.map((column) => escapeCsvValue(column.label)).join(',');
    const body = rows.map((row) => columns.map((column) => escapeCsvValue(row[column.key])).join(',')).join('\n');
    const csv = [header, body].filter(Boolean).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function getVarianceDisplayStyle(value) {
    const numericValue = toNumber(String(value ?? '').replace(/,/g, ''));
    if (numericValue < -0.009) {
        return 'color:#b91c1c; font-weight:700;';
    }
    if (numericValue > 0.009) {
        return 'color:#166534; font-weight:700;';
    }
    return 'color:#1f2937; font-weight:700;';
}

function renderAuditReportSummary(summary = []) {
    if (!summary.length) return '';

    return `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:14px;">
            ${summary.map((item) => `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
                    <div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">${item.label}</div>
                    <div style="font-size:16px; font-weight:700; ${item.style || 'color:#1f2937;'}">${item.value}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderAuditReportPreview(report) {
    const preview = document.getElementById('auditReportPreview');
    if (!preview) return;

    if (!report?.rows?.length) {
        preview.innerHTML = '<div style="padding:20px; color:#64748b;">No data found for this report in the selected period.</div>';
        return;
    }

    const noteMarkup = report.notes?.length
        ? `<div style="margin-bottom:12px; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; color:#475569; font-size:12px;">
            ${report.notes.map((note) => `<div>${note}</div>`).join('')}
        </div>`
        : '';
    const summaryMarkup = renderAuditReportSummary(report.summary || []);

      preview.innerHTML = `
          <div style="font-weight:700; color:#2c3e50; margin-bottom:10px;">${report.title}</div>
          ${summaryMarkup}
          ${noteMarkup}
          <table style="width:100%; border-collapse:collapse;">
              <thead>
                <tr>
                    ${report.columns.map((column) => `<th style="padding:12px; background:#f8fafc; color:#7092ae;">${column.label}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                  ${report.rows.map((row) => {
                      const isTotalRow = Object.values(row || {}).some((value) => String(value || '').trim().toUpperCase() === 'TOTAL');
                      const rowStyle = isTotalRow
                          ? 'background:#e2e8f0; font-weight:700; color:#0f172a;'
                          : '';
                      const cellStyle = isTotalRow
                          ? 'padding:10px; border-bottom:1px solid #cbd5e1;'
                          : 'padding:10px; border-bottom:1px solid #e2e8f0;';
                      return `
                      <tr style="${rowStyle}">
                          ${report.columns.map((column) => {
                              const varianceStyle = column.key === 'variance'
                                  ? getVarianceDisplayStyle(row[column.key])
                                  : '';
                              return `<td style="${cellStyle}${varianceStyle}">${row[column.key] ?? ''}</td>`;
                          }).join('')}
                      </tr>
                  `;
                  }).join('')}
              </tbody>
          </table>
      `;
}

function renderRawImportPreview(rows) {
    const previewWrap = document.getElementById('rawImportPreviewWrap');
    const previewBody = document.getElementById('rawImportPreviewBody');
    if (!previewWrap || !previewBody) return;

    if (!rows.length) {
        previewWrap.style.display = 'none';
        previewBody.innerHTML = '';
        return;
    }

        previewWrap.style.display = 'block';
    previewBody.innerHTML = rows.slice(0, 10).map((row) => `
        <tr>
            <td>${row.item_code || '-'}</td>
            <td>${row.name}</td>
            <td>${row.buy_unit}</td>
            <td>${row.store_unit}</td>
            <td>${row.conversion_factor}</td>
            <td>${row.price}</td>
            <td>${row.restaurant_id}</td>
        </tr>
    `).join('');
}

function renderProductImportPreview(rows) {
    const previewWrap = document.getElementById('productImportPreviewWrap');
    const previewBody = document.getElementById('productImportPreviewBody');
    if (!previewWrap || !previewBody) return;

    if (!rows.length) {
        previewWrap.style.display = 'none';
        previewBody.innerHTML = '';
        return;
    }

    previewWrap.style.display = 'block';
    previewBody.innerHTML = rows.slice(0, 10).map((row) => `
        <tr>
            <td>${row.name}</td>
            <td>${row.category}</td>
            <td>${row.price}</td>
            <td>${row.restaurant_id}</td>
        </tr>
    `).join('');
}

function renderRecipeImportPreview(rows) {
    const previewWrap = document.getElementById('recipeImportPreviewWrap');
    const previewBody = document.getElementById('recipeImportPreviewBody');
    if (!previewWrap || !previewBody) return;

    if (!rows.length) {
        previewWrap.style.display = 'none';
        previewBody.innerHTML = '';
        return;
    }

    previewWrap.style.display = 'block';
    previewBody.innerHTML = rows.slice(0, 10).map((row) => `
        <tr>
            <td>${row.finished_item_name}</td>
            <td>${row.material_name}</td>
            <td>${row.qty_per_unit}</td>
            <td>${row.restaurant_id}</td>
        </tr>
    `).join('');
}

async function readRawImportRows() {
    const fileInput = document.getElementById('rawImportFile');
    const restaurantIdOverride = document.getElementById('rawImportRestaurantId')?.value.trim() || '';
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('Choose a CSV file first.');

    const text = await file.text();
    const parsedRows = parseCsvText(text);
    return normalizeRawImportRows(parsedRows, restaurantIdOverride);
}

async function readProductImportRows() {
    const fileInput = document.getElementById('productImportFile');
    const restaurantIdOverride = document.getElementById('productImportRestaurantId')?.value.trim() || '';
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('Choose a CSV file first.');

    const text = await file.text();
    const parsedRows = parseCsvText(text);
    return normalizeProductImportRows(parsedRows, restaurantIdOverride);
}

async function readRecipeImportRows() {
    const fileInput = document.getElementById('recipeImportFile');
    const restaurantIdOverride = document.getElementById('recipeImportRestaurantId')?.value.trim() || '';
    const file = fileInput?.files?.[0];
    if (!file) throw new Error('Choose a CSV file first.');

    const text = await file.text();
    const parsedRows = parseCsvText(text);
    return normalizeRecipeImportRows(parsedRows, restaurantIdOverride);
}

function setProductImportStatus(message, isError = false) {
    const node = document.getElementById('productImportStatus');
    if (!node) return;
    node.innerText = message;
    node.style.color = isError ? '#b91c1c' : '#64748b';
}

function setRecipeImportStatus(message, isError = false) {
    const node = document.getElementById('recipeImportStatus');
    if (!node) return;
    node.innerText = message;
    node.style.color = isError ? '#b91c1c' : '#64748b';
}

function createKitchenDraftRow() {
    return { productId: '', productSearch: '', qty: '' };
}

function ensureKitchenDrafts() {
    if (!Array.isArray(state.kitchenDrafts) || state.kitchenDrafts.length === 0) {
        state.kitchenDrafts = [createKitchenDraftRow()];
    }
}

function clampClosingQty(value, max) {
    const numericValue = Math.round(toNumber(value) * 100) / 100;
    if (numericValue < 0) return 0;
    if (numericValue > max) return Math.round(toNumber(max) * 100) / 100;
    return numericValue;
}

function setLoading(button, isLoading, text = 'Processing...') {
    if (!button) return;
    button.disabled = isLoading;
    button.dataset.originalText = button.dataset.originalText || button.innerText;
    button.innerText = isLoading ? text : button.dataset.originalText;
}

async function loadCurrentShift() {
    state.currentShift = await ensureActiveShift(getScope(), repositories);
    await refreshCurrentShiftSummary();
    return state.currentShift;
}

async function refreshCurrentShiftSummary() {
    const dateNode = document.getElementById('salesCurrentDate');
    const shiftNode = document.getElementById('salesCurrentShift');
    if (!dateNode || !shiftNode) return;

    if (!state.currentShift) {
        dateNode.innerText = '--';
        shiftNode.innerText = '--';
        updateShiftStatusPanel();
        return;
    }

    const shiftDate = toDateOnly(state.currentShift.created_at || new Date());
    let shiftLabel = state.currentShift.shift_type || (state.shiftSystem === 1 ? 'FULL' : '');

    if (!shiftLabel) {
        const { data, error } = await repositories.getShiftReportsByRange(getScope(), shiftDate, shiftDate);
        if (!error) {
            const annotated = annotateShiftsForDisplay(data || [], state.shiftSystem);
            shiftLabel = annotated.find((shift) => String(shift.id) === String(state.currentShift.id))?.shiftLabel || '';
        }
    }

    dateNode.innerText = formatLongDate(`${shiftDate}T00:00:00`);
    shiftNode.innerText = shiftLabel || (state.shiftSystem === 2 ? 'DAY' : 'FULL');
    updateShiftStatusPanel(shiftDate, shiftLabel || (state.shiftSystem === 2 ? 'DAY' : 'FULL'));
}

function updateShiftStatusPanel(shiftDateOverride = '', shiftTypeOverride = '') {
    const branchNode = document.getElementById('sidebarShiftBranch');
    const dateNode = document.getElementById('sidebarShiftDate');
    const metaNode = document.getElementById('sidebarShiftMeta');
    if (!branchNode || !dateNode || !metaNode) return;

    const branchName = getCurrentBranchName();
    const shiftDate = shiftDateOverride || (state.currentShift ? toDateOnly(state.currentShift.created_at || new Date()) : '');
    const shiftType = shiftTypeOverride || state.currentShift?.shift_type || (state.shiftSystem === 2 ? 'DAY' : 'FULL');
    const modeLabel = state.shiftSystem === 2 ? 'DAY / NIGHT' : 'FULL SHIFT';

    branchNode.innerText = branchName || '--';
    dateNode.innerText = shiftDate ? formatLongDate(`${shiftDate}T00:00:00`) : '--';
    metaNode.innerText = state.currentShift
        ? `${branchName || '--'} · ${shiftType} shift is active`
        : `${branchName || '--'} · No active shift loaded`;
    metaNode.innerText = state.currentShift
        ? `${shiftType} · ${modeLabel}`
        : 'NO ACTIVE SHIFT';
}

function resolveDirectSalesMaterial(materialName, materials = state.rawMaterials) {
    return (materials || []).find((material) => entityNamesMatch(material.name, materialName)) || null;
}

function getDirectSalesRecipes(productName, recipes = state.recipeMatrix) {
    return (recipes || []).filter((recipe) => entityNamesMatch(recipe.finished_item_name, productName));
}

function isRestaurantDirectStoreProduct(product, materials = state.rawMaterials, recipes = state.recipeMatrix) {
    if (!product || isDirectSalesMode()) return false;

    const category = String(product.category || '').trim().toLowerCase();
    const hasDrinkCategory = category.includes('drink');
    const hasRecipeRows = getDirectSalesRecipes(product.name, recipes).length > 0;
    const directMaterial = resolveDirectSalesMaterial(product.name, materials);

    return hasDrinkCategory && !hasRecipeRows && Boolean(directMaterial);
}

function usesDirectStockMath(item) {
    if (isDirectSalesMode()) return true;
    return String(item?.sale_mode || '').toLowerCase() === 'direct';
}

function isRestaurantKeyStoreCheckEnabled() {
    return !isDirectSalesMode();
}

function getKeyShiftControlMaterials() {
    return (state.rawMaterials || [])
        .filter((material) => material?.is_key_shift_item === true)
        .sort((left, right) => getDisplayMaterialName(left.name).localeCompare(getDisplayMaterialName(right.name)));
}

function getCurrentShiftWindowStartMs() {
    return state.currentShift?.created_at ? new Date(state.currentShift.created_at).getTime() : 0;
}

function isCurrentShiftTimestamp(value) {
    const shiftStart = getCurrentShiftWindowStartMs();
    if (!shiftStart) return false;
    const timestamp = value ? new Date(value).getTime() : 0;
    return timestamp >= shiftStart;
}

function getKitchenEligibleItems() {
    return (state.items || []).filter((item) => String(item?.sale_mode || '').toLowerCase() !== 'direct');
}

function calculateDirectSalesAvailability(product, materials = state.rawMaterials, recipes = state.recipeMatrix) {
    const recipeRows = getDirectSalesRecipes(product.name, recipes);
    if (recipeRows.length && isMeasuredRecipeProductName(product.name)) {
        let availableUnits = Number.POSITIVE_INFINITY;

        for (const recipe of recipeRows) {
            const material = resolveDirectSalesMaterial(recipe.material_name, materials);
            const recipeQty = toNumber(recipe.qty_per_unit);
            if (!material || recipeQty <= 0) {
                return {
                    availableQty: 0,
                    sourceMode: 'Recipe',
                    sourceLabel: 'Recipe',
                    availableUnitLabel: 'sellable units'
                };
            }

            const stockLevel = toNumber(material.stock_level ?? material.current_stock);
            availableUnits = Math.min(availableUnits, Math.floor(stockLevel / recipeQty));
        }

        return {
            availableQty: Number.isFinite(availableUnits) ? availableUnits : 0,
            sourceMode: 'Recipe',
            sourceLabel: 'Recipe',
            availableUnitLabel: 'sellable units'
        };
    }

    const directMaterial = resolveDirectSalesMaterial(product.name, materials);
    return {
        availableQty: toNumber(directMaterial?.stock_level ?? directMaterial?.current_stock),
        sourceMode: 'Direct',
        sourceLabel: 'Direct',
        availableUnitLabel: directMaterial?.store_unit || 'units'
    };
}

function getSellableUnitsForMaterial(material) {
    const stockLevel = toNumber(material?.stock_level ?? material?.current_stock);
    const conversionFactor = Math.max(toNumber(material?.conversion_factor), 1);
    const buyUnit = String(material?.buy_unit || '').trim().toLowerCase();
    const storeUnit = String(material?.store_unit || '').trim().toLowerCase();

    if (!material) return 0;
    if (!buyUnit || !storeUnit || buyUnit === storeUnit) {
        return stockLevel;
    }

    return stockLevel / conversionFactor;
}

function getIssueHistoryForShift(shiftId) {
    return (state.barStockIssues || []).filter((issue) => String(issue.shift_id || '') === String(shiftId || ''));
}

function canDeleteStockHistory() {
    return [ROLES.DEVELOPER, ROLES.SYSTEM_ADMIN, ROLES.MANAGER].includes(state.role);
}

function canAdjustStockLevels() {
    return [ROLES.DEVELOPER, ROLES.SYSTEM_ADMIN, ROLES.MANAGER].includes(state.role);
}

function isRecordInCurrentShiftWindow(row) {
    if (!row || !state.currentShift?.created_at) return false;
    if (row.shift_id && state.currentShift?.id) {
        return String(row.shift_id) === String(state.currentShift.id);
    }

    const shiftStart = new Date(state.currentShift.created_at).getTime();
    const rowCreatedAt = row.created_at ? new Date(row.created_at).getTime() : 0;
    return rowCreatedAt >= shiftStart;
}

function getIssuedSourceQtyForProduct(productName, shiftId = state.currentShift?.id) {
    return getIssueHistoryForShift(shiftId)
        .filter((issue) => entityNamesMatch(issue.source_material_name, productName))
        .reduce((sum, issue) => sum + toNumber(issue.qty_issued_source), 0);
}

function getIssuedTargetQtyForProduct(productName, shiftId = state.currentShift?.id) {
    return getIssueHistoryForShift(shiftId)
        .filter((issue) => entityNamesMatch(issue.target_product_name, productName))
        .reduce((sum, issue) => sum + toNumber(issue.qty_added_target), 0);
}

function updateSalesTableHeaders() {
    const openingNode = document.getElementById('salesHeaderOpening');
    const addedNode = document.getElementById('salesHeaderAdded');
    const closingNode = document.getElementById('salesHeaderClosing');
    const soldNode = document.getElementById('salesHeaderSold');

    if (!openingNode || !addedNode || !closingNode || !soldNode) return;

    if (isDirectSalesMode()) {
        openingNode.innerText = 'Opening';
        addedNode.innerText = 'Added';
        closingNode.innerText = 'Bal Qty';
        soldNode.innerText = 'Sold';
        return;
    }

    openingNode.innerText = 'Opening';
    addedNode.innerText = 'Added';
    closingNode.innerText = 'Closing';
    soldNode.innerText = 'Sold';
}

async function loadInventory() {
    const scope = getScope();
    const isDirectMode = isDirectSalesMode();
    const requests = [
        repositories.getProducts(scope),
        state.currentShift?.id
            ? repositories.getShiftInventory(scope, state.currentShift.id)
            : Promise.resolve({ data: [], error: null }),
        repositories.getRawMaterials(scope),
        repositories.getRecipes(scope)
    ];

    const [productsResult, shiftInventoryResult, rawMaterialsResult, recipesResult] = await Promise.all(requests);
    const { data: products, error: productsError } = productsResult;

    if (productsError) throw productsError;
    if (shiftInventoryResult.error) throw shiftInventoryResult.error;
    if (rawMaterialsResult?.error) throw rawMaterialsResult.error;
    if (recipesResult?.error) throw recipesResult.error;

    if (rawMaterialsResult) state.rawMaterials = rawMaterialsResult.data || [];
    if (recipesResult) state.recipeMatrix = recipesResult.data || [];

    const shiftRows = shiftInventoryResult.data || [];
    state.items = (products || []).map((product) => {
        const shiftRow = shiftRows.find((row) => row.product_id === product.id);
        const directRestaurantItem = !isDirectMode && isRestaurantDirectStoreProduct(product, state.rawMaterials, state.recipeMatrix);
        const usesDirectMath = isDirectMode || directRestaurantItem;
        const directMeta = usesDirectMath
            ? calculateDirectSalesAvailability(product, state.rawMaterials, state.recipeMatrix)
            : null;
        const measuredItem = isDirectMode ? isMeasuredRecipeProductName(product.name) : false;
        const openingQty = toNumber(shiftRow?.bbf);
        const availableQty = usesDirectMath
            ? (measuredItem
                ? openingQty + toNumber(shiftRow?.added_today)
                : getSellableUnitsForMaterial(resolveDirectSalesMaterial(product.name, state.rawMaterials)))
            : 0;
        const issuedOutQty = isDirectMode && !measuredItem ? getIssuedSourceQtyForProduct(product.name) : 0;
        const addedQty = usesDirectMath
            ? (measuredItem
                ? toNumber(shiftRow?.added_today)
                : (availableQty + issuedOutQty - openingQty))
            : toNumber(shiftRow?.added_today);
        return {
            id: shiftRow?.id || null,
            product_id: product.id,
            name: product.name,
            price: toNumber(product.price),
            category: product.category || '',
            added_today: addedQty,
            bbf: openingQty,
            sold: 0,
            spoilt: 0,
            closing_stock: usesDirectMath ? null : getDraftedClosingQty(product.id, shiftRow?.close_qty),
            available_stock: availableQty,
            issued_qty: issuedOutQty,
            sale_mode: isDirectMode
                ? (measuredItem ? 'measured' : 'full')
                : (directRestaurantItem ? 'direct' : 'kitchen'),
            deduction_mode: directMeta?.sourceMode || '',
            deduction_mode_label: directMeta?.sourceLabel || '',
            available_unit_label: directMeta?.availableUnitLabel || ''
        };
    });

    updateSalesTableHeaders();
    renderSales();
    renderFinishedProducts();
    renderKitchen();
}

async function loadRawMaterials() {
    const { data, error } = await repositories.getRawMaterials(getScope());
    if (error) throw error;
    state.rawMaterials = data || [];
    renderRawMaterialNameSuggestions();
    updateRawMaterialNameHint();
    const canManageRawMaterials = hasPermission(state.permissions, PERMISSIONS.MANAGE_RAW_MATERIALS);

    const rawBody = document.getElementById('rawMaterialBody');
    if (rawBody) {
        rawBody.innerHTML = state.rawMaterials.map((material) => `
            <tr>
                <td>${material.name}</td>
                <td>${material.buy_unit}</td>
                <td>${material.store_unit}</td>
                <td>${material.conversion_factor}</td>
                <td>${material.price}</td>
                <td>${(toNumber(material.price) / Math.max(toNumber(material.conversion_factor), 1)).toFixed(2)}</td>
                <td>${material.reorder_level !== undefined && material.reorder_level !== null && material.reorder_level !== '' ? `${formatQuantity(material.reorder_level)} ${material.store_unit || ''}`.trim() : '--'}</td>
                <td style="text-align: right;">
                    ${canManageRawMaterials ? `
                        <button class="btn compact-btn" style="background:#edf2f7;" onclick="editRawMaterial('${material.id}')">Edit</button>
                        <button class="btn compact-btn" style="background:#e74c3c; color:white;" onclick="deleteRawMaterial('${material.id}')">Delete</button>
                    ` : '--'}
                </td>
            </tr>
        `).join('');
    }

    applyMasterPageModes();
}

async function loadBranches() {
    const { data, error } = await repositories.getBranches(getScope());
    if (error) throw error;
    state.branches = (data || []).filter((branch) =>
        !state.restaurantId || String(branch.restaurant_id) === String(state.restaurantId)
    );
    syncShiftSystemWithActiveBranch();
    syncOperatingModeWithActiveBranch();
    updateBranchSwitcher();
    applyRoleAccess();
    updatePageBranchLabels();
    updateShiftStatusPanel();
}

async function loadRecipes() {
    const { data, error } = await repositories.getRecipes(getScope());
    if (error) throw error;
    state.recipeMatrix = data || [];
    const canManageRecipes = hasPermission(state.permissions, PERMISSIONS.MANAGE_RECIPES);
    document.getElementById('recipeMatrixBody').innerHTML = state.recipeMatrix.map((recipe) => `
        <tr>
            <td>${getDisplayProductName(recipe.finished_item_name)}</td>
            <td>${getDisplayMaterialName(recipe.material_name)}</td>
            <td>${formatRecipeUsage(recipe.material_name, recipe.qty_per_unit)}</td>
            <td>
                ${canManageRecipes ? `
                    <button class="btn" style="background:#edf2f7; margin-right:8px;" onclick="editRecipe('${String(recipe.finished_item_name || '').replace(/'/g, "\\'")}')">Edit</button>
                    <button class="btn" style="background:#e74c3c; color:white;" onclick="deleteRecipe('${recipe.id}')">Delete</button>
                ` : '--'}
            </td>
        </tr>
    `).join('');

    applyMasterPageModes();
}

function getRawMaterialMeta(materialName) {
    const normalizedName = String(materialName || '').trim().toLowerCase();
    if (!normalizedName) return null;
    return state.rawMaterials.find((item) => String(item.name || '').trim().toLowerCase() === normalizedName) || null;
}

function formatRecipeUsage(materialName, qtyPerUnit) {
    const material = getRawMaterialMeta(materialName);
    const storeUnit = material?.store_unit || 'store unit';
    return `${formatQuantity(qtyPerUnit)} ${storeUnit} / item`;
}

function updateIngredientUnitHint(rowNumber) {
    const unitNode = document.getElementById(`ingUnit${rowNumber}`);
    const ingredientSelect = document.getElementById(`ing${rowNumber}`);
    if (!unitNode || !ingredientSelect) return;

    const material = getRawMaterialMeta(ingredientSelect.value);
    if (!material) {
        unitNode.innerText = 'Store unit: --';
        return;
    }

    const conversion = Math.max(toNumber(material.conversion_factor), 1);
    const buyUnit = material.buy_unit || '--';
    const storeUnit = material.store_unit || '--';
    unitNode.innerText = `Store unit: ${storeUnit} | Buy unit: ${buyUnit} | Conv: 1 to ${formatQuantity(conversion, 2)}`;
}

async function loadStockReceipts() {
    const { data, error } = await repositories.getStockReceipts(getScope());
    if (error) throw error;
    const currentShiftId = String(state.currentShift?.id || '');
    const currentShiftCreatedAt = state.currentShift?.created_at
        ? new Date(state.currentShift.created_at).getTime()
        : 0;
    const materialMetaMap = new Map(
        (state.rawMaterials || []).map((material) => [
            String(material.name || '').trim().toLowerCase(),
            {
                buyUnit: material.buy_unit || '',
                storeUnit: material.store_unit || material.buy_unit || '',
                conversionFactor: Math.max(toNumber(material.conversion_factor), 1),
                buyUnitPrice: toNumber(material.price)
            }
        ])
    );
    const shiftRows = (data || []).filter((row) => {
        if (!currentShiftId) return true;

        if (String(row.shift_id || '') === currentShiftId) {
            return true;
        }

        if (!row.shift_id && currentShiftCreatedAt > 0) {
            const receiptCreatedAt = row.created_at ? new Date(row.created_at).getTime() : 0;
            return receiptCreatedAt >= currentShiftCreatedAt;
        }

        return false;
    });
    state.stockReceipts = shiftRows;
    const canDelete = canDeleteStockHistory();
    const historyTotalNode = document.getElementById('stockReceiptHistoryTotal');
    const shiftReceiptTotal = shiftRows.reduce((sum, row) => {
        const meta = materialMetaMap.get(String(row.material_name || '').trim().toLowerCase());
        const totalReceivedCost = row.total_received_cost ?? (toNumber(row.qty_received) * toNumber(row.buy_unit_price ?? meta?.buyUnitPrice));
        return sum + toNumber(totalReceivedCost);
    }, 0);
    if (historyTotalNode) {
        historyTotalNode.innerText = `Shift Received Total: KES ${formatMoney(shiftReceiptTotal)}`;
    }

    document.getElementById('stockReceiptsBody').innerHTML = shiftRows.length ? shiftRows.map((row) => `
        <tr>
            <td>${formatLongDate(row.created_at)}</td>
            <td>${getDisplayMaterialName(row.material_name)}</td>
            <td>${(() => {
                const meta = materialMetaMap.get(String(row.material_name || '').trim().toLowerCase());
                return row.buy_unit || meta?.buyUnit || '--';
            })()}</td>
            <td>${toNumber(row.qty_received).toLocaleString()}</td>
            <td>${(() => {
                const meta = materialMetaMap.get(String(row.material_name || '').trim().toLowerCase());
                const totalReceivedCost = row.total_received_cost ?? (toNumber(row.qty_received) * toNumber(row.buy_unit_price ?? meta?.buyUnitPrice));
                return formatMoney(totalReceivedCost);
            })()}</td>
            <td>${(() => {
                const meta = materialMetaMap.get(String(row.material_name || '').trim().toLowerCase());
                return row.store_unit || meta?.storeUnit || '--';
            })()}</td>
            <td>${(() => {
                const meta = materialMetaMap.get(String(row.material_name || '').trim().toLowerCase());
                const conversionFactor = Math.max(toNumber(row.conversion_factor ?? meta?.conversionFactor), 1);
                const postedQty = toNumber(row.qty_posted_store ?? (toNumber(row.qty_received) * conversionFactor));
                const storeUnitPrice = toNumber(row.store_unit_price ?? (toNumber(row.buy_unit_price ?? meta?.buyUnitPrice) / conversionFactor));
                return `${postedQty.toLocaleString()} @ ${formatMoney(storeUnitPrice)}`;
            })()}</td>
            <td>${row.received_by || '--'}</td>
            <td style="text-align:right;">
                ${canDelete && isRecordInCurrentShiftWindow(row)
                    ? `<button class="btn" style="background:#e74c3c; color:white;" onclick="deleteStockReceiptHistory('${row.id}')">Delete</button>`
                    : '--'}
            </td>
        </tr>
    `).join('') : '<tr><td colspan="9" style="text-align:center; padding:24px; color:#64748b;">No items received in this shift yet.</td></tr>';
}

async function loadSupplyItems() {
    const { data, error } = await repositories.getSupplyItems(getScope());
    if (error) throw error;
    state.supplyItems = data || [];
}

async function loadSupplyReceipts() {
    const { data, error } = await repositories.getSupplyReceipts(getScope());
    if (error) throw error;

    const currentShiftId = String(state.currentShift?.id || '');
    const currentShiftCreatedAt = state.currentShift?.created_at
        ? new Date(state.currentShift.created_at).getTime()
        : 0;

    const shiftRows = (data || []).filter((row) => {
        if (!currentShiftId) return true;
        if (String(row.shift_id || '') === currentShiftId) {
            return true;
        }
        if (!row.shift_id && currentShiftCreatedAt > 0) {
            const receiptCreatedAt = row.created_at ? new Date(row.created_at).getTime() : 0;
            return receiptCreatedAt >= currentShiftCreatedAt;
        }
        return false;
    });

    state.supplyReceipts = shiftRows;
    renderSupplyReceiptsView();
}

async function loadStockTransfers() {
    const { data, error } = await repositories.getStockTransfers(getScope());
    if (error) throw error;
    state.stockTransfers = data || [];
    renderStockTransferView();
}

async function ensureCurrentShiftKeyStoreChecks() {
    if (!isRestaurantKeyStoreCheckEnabled() || !state.currentShift?.id) {
        state.keyStoreChecks = [];
        return;
    }

    const keyMaterials = getKeyShiftControlMaterials();
    if (!keyMaterials.length) {
        state.keyStoreChecks = [];
        return;
    }

    const existingResult = await repositories.getShiftStoreChecks(getScope(), state.currentShift.id);
    if (existingResult.error) throw existingResult.error;

    const existingRows = existingResult.data || [];
    const existingByMaterialId = new Map(existingRows.map((row) => [String(row.material_id || ''), row]));
    const missingMaterials = keyMaterials.filter((material) => !existingByMaterialId.has(String(material.id)));

    if (missingMaterials.length) {
        const previousShiftResult = await repositories.getLatestClosedShift(getScope());
        if (previousShiftResult.error) throw previousShiftResult.error;

        const previousShiftId = previousShiftResult.data?.id || '';
        let previousRows = [];
        if (previousShiftId) {
            const previousRowsResult = await repositories.getShiftStoreChecks(getScope(), previousShiftId);
            if (previousRowsResult.error) throw previousRowsResult.error;
            previousRows = previousRowsResult.data || [];
        }

        const previousByMaterialId = new Map(previousRows.map((row) => [String(row.material_id || ''), row]));
        const seedRows = missingMaterials.map((material) => {
            const previousRow = previousByMaterialId.get(String(material.id));
            const openingQty = previousRow && previousRow.actual_closing_qty !== null && previousRow.actual_closing_qty !== undefined
                ? toNumber(previousRow.actual_closing_qty)
                : toNumber(material.stock_level ?? material.current_stock);

            return {
                shift_id: state.currentShift.id,
                material_id: material.id,
                material_name_snapshot: material.name,
                store_unit_snapshot: material.store_unit || '',
                opening_qty: openingQty,
                actual_closing_qty: null,
                expected_qty: null,
                variance_qty: null,
                notes: ''
            };
        });

        if (seedRows.length) {
            const upsertResult = await repositories.upsertShiftStoreChecks(getScope(), seedRows);
            if (upsertResult.error) throw upsertResult.error;
        }
    }

    const refreshedResult = await repositories.getShiftStoreChecks(getScope(), state.currentShift.id);
    if (refreshedResult.error) throw refreshedResult.error;
    state.keyStoreChecks = refreshedResult.data || [];
}

function getCurrentShiftTransfersForBranch() {
    const currentBranchId = String(state.branchId || '');
    return (state.stockTransfers || []).filter((row) => {
        const inCurrentWindow = isCurrentShiftTimestamp(row.created_at);
        if (!inCurrentWindow) return false;
        return String(row.from_branch_id || '') === currentBranchId || String(row.to_branch_id || '') === currentBranchId;
    });
}

function buildKeyStoreCheckRows() {
    const keyMaterials = getKeyShiftControlMaterials();
    const existingByMaterialId = new Map((state.keyStoreChecks || []).map((row) => [String(row.material_id || ''), row]));
    const receiptRows = state.stockReceipts || [];
    const transferRows = getCurrentShiftTransfersForBranch();
    const recipeRows = state.recipeMatrix || [];
    const items = state.items || [];

    return keyMaterials.map((material) => {
        const existingRow = existingByMaterialId.get(String(material.id)) || null;
        const materialName = material.name;
        const openingQty = toNumber(existingRow?.opening_qty ?? material.stock_level ?? material.current_stock);
        const receivedQty = receiptRows
            .filter((row) => entityNamesMatch(row.material_name, materialName))
            .reduce((sum, row) => sum + toNumber(row.qty_posted_store ?? (toNumber(row.qty_received) * Math.max(toNumber(row.conversion_factor), 1))), 0);
        const transferredInQty = transferRows
            .filter((row) => String(row.to_branch_id || '') === String(state.branchId || '') && entityNamesMatch(row.material_name, materialName))
            .reduce((sum, row) => sum + toNumber(row.qty), 0);
        const transferredOutQty = transferRows
            .filter((row) => String(row.from_branch_id || '') === String(state.branchId || '') && entityNamesMatch(row.material_name, materialName))
            .reduce((sum, row) => sum + toNumber(row.qty), 0);
        const kitchenConsumedQty = recipeRows.reduce((sum, recipe) => {
            if (!entityNamesMatch(recipe.material_name, materialName)) {
                return sum;
            }
            const item = items.find((entry) => entityNamesMatch(entry.name, recipe.finished_item_name));
            return sum + (toNumber(item?.added_today) * toNumber(recipe.qty_per_unit));
        }, 0);
        const expectedQty = openingQty + receivedQty + transferredInQty - transferredOutQty - kitchenConsumedQty;
        const draftValue = state.keyStoreCheckDrafts[String(material.id)];
        const actualValue = draftValue !== undefined
            ? draftValue
            : (existingRow?.actual_closing_qty ?? '');
        const actualQty = String(actualValue).trim() === '' ? null : toNumber(actualValue);
        const varianceQty = actualQty === null ? null : actualQty - expectedQty;

        return {
            id: existingRow?.id || '',
            materialId: material.id,
            materialName,
            unit: existingRow?.store_unit_snapshot || material.store_unit || '',
            openingQty,
            expectedQty,
            actualValue,
            actualQty,
            varianceQty
        };
    });
}

function renderKeyStoreChecks() {
    const section = document.getElementById('keyStoreCheckSection');
    const body = document.getElementById('keyStoreCheckBody');
    const status = document.getElementById('keyStoreCheckStatus');
    if (!section || !body || !status) return;

    if (!isRestaurantKeyStoreCheckEnabled()) {
        section.classList.add('hidden');
        body.innerHTML = '';
        status.innerText = '';
        return;
    }

    const rows = buildKeyStoreCheckRows();
    if (!rows.length) {
        section.classList.add('hidden');
        body.innerHTML = '';
        status.innerText = '';
        return;
    }

    section.classList.remove('hidden');
    status.innerText = 'Actual balances are mandatory for all key items before the shift can be closed.';
    body.innerHTML = rows.map((row) => `
        <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:7px 10px; font-size:12px; font-weight:600;">${getDisplayMaterialName(row.materialName)}</td>
            <td style="padding:7px 10px; font-size:12px;">${row.unit || '--'}</td>
            <td style="padding:7px 10px; font-size:12px;">${formatQuantity(row.openingQty, 4)}</td>
            <td style="padding:7px 10px; font-size:12px; font-weight:600; color:#1f2937;">${formatQuantity(row.expectedQty, 4)}</td>
            <td style="padding:7px 10px;">
                <input
                    type="number"
                    min="0"
                    step="0.01"
                    id="keyStoreActual_${row.materialId}"
                    value="${row.actualValue === null ? '' : row.actualValue}"
                    oninput="updateKeyStoreCheckDraft('${row.materialId}', this.value)"
                    style="width:88px; min-height:32px; padding:4px 8px; font-size:12px;">
            </td>
            <td id="keyStoreVar_${row.materialId}" style="padding:7px 10px; font-size:12px; font-weight:700; ${row.varianceQty === null ? 'color:#64748b;' : getVarianceDisplayStyle(row.varianceQty)}">${row.varianceQty === null ? '--' : formatQuantity(row.varianceQty, 4)}</td>
        </tr>
    `).join('');
}

function collectKeyStoreChecks() {
    return buildKeyStoreCheckRows().map((row) => ({
        id: row.id,
        materialId: row.materialId,
        materialName: row.materialName,
        unit: row.unit,
        openingQty: row.openingQty,
        expectedQty: row.expectedQty,
        actualClosingQty: row.actualQty,
        hasActualEntry: row.actualQty !== null,
        varianceQty: row.varianceQty
    }));
}

async function loadBarStockIssues() {
    const { data, error } = await repositories.getBarStockIssues(getScope());
    if (error) throw error;
    state.barStockIssues = data || [];
    renderBarIssueView();
}

async function loadKitchenData() {
    const tbody = document.getElementById('kitchenBody');
    if (!tbody) return;
    if (!state.currentShift?.id) {
        tbody.innerHTML = '<tr><td colspan="3">No active shift</td></tr>';
        return;
    }

    const { data, error } = await repositories.getShiftInventory(getScope(), state.currentShift.id);
    if (error) throw error;

    if (!data?.length) {
        tbody.innerHTML = '<tr><td colspan="3">No production yet</td></tr>';
        return;
    }

    const productNames = new Map(state.items.map((item) => [String(item.product_id), getDisplayProductName(item.name)]));
    const canAdjust = hasPermission(state.permissions, PERMISSIONS.POST_KITCHEN_OUTPUT);
    tbody.innerHTML = data.map((row) => `
        <tr>
            <td>${productNames.get(String(row.product_id)) || 'Unknown'}</td>
            <td>${formatQuantity(row.added_today || 0)}</td>
            <td style="text-align:right;">
                ${canAdjust && toNumber(row.added_today) > 0
                    ? `<button class="btn" style="background:#edf2f7;" onclick="adjustKitchenProduction('${row.product_id}')">Adjust</button>`
                    : '--'}
            </td>
        </tr>
    `).join('');
}

function updateDropdowns() {
    const productNameMarkup = state.items
        .map((item) => `<option value="${item.name}">${getDisplayProductName(item.name)}</option>`)
        .join('');
    const ingredientMarkup = state.rawMaterials
        .map((item) => `<option value="${item.name}">${getDisplayMaterialName(item.name)}</option>`)
        .join('');

    const masterProductSelect = document.getElementById('masterProductSelect');
    const masterProductOptions = document.getElementById('masterProductOptions');
    if (masterProductOptions) masterProductOptions.innerHTML = productNameMarkup;
    if (masterProductSelect && masterProductSelect.tagName === 'SELECT') {
        masterProductSelect.innerHTML = `<option value="">-- Select Product --</option>${productNameMarkup}`;
    }

    refreshRecipeCategoryOptions();
    refreshFinishedProductCategoryOptions();

    document.querySelectorAll('.ing-select').forEach((select) => {
        if (select.tagName === 'SELECT') {
            select.innerHTML = `<option value="">-- Select Ingredient --</option>${ingredientMarkup}`;
        }
    });
    for (let i = 1; i <= 3; i += 1) {
        const ingList = document.getElementById(`ingList${i}`);
        if (ingList) ingList.innerHTML = ingredientMarkup;
    }

    for (let i = 1; i <= 3; i += 1) {
        updateIngredientUnitHint(i);
    }

    renderKitchenBatchInputs();
    renderStockReceiptBatchInputs();
    renderBarIssueView();
}

function renderKitchenBatchInputs() {
    const container = document.getElementById('kitchenBatchInputs');
    if (!container) return;

    const kitchenItems = getKitchenEligibleItems();

    if (!kitchenItems.length) {
        container.innerHTML = '<div style="color:#64748b; font-size:14px;">No finished products available yet.</div>';
        return;
    }

    ensureKitchenDrafts();

    const selectedProductIds = state.kitchenDrafts
        .map((draft) => String(draft.productId || ''))
        .filter(Boolean);

    container.innerHTML = `
        <div style="display:grid; gap:10px;">
            ${state.kitchenDrafts.map((draft, index) => `
                <div style="display:grid; grid-template-columns:minmax(0, 2fr) minmax(120px, 180px) auto; gap:10px; align-items:center;">
                    <input
                        type="text"
                        id="kitchenProduct${index}"
                        name="kitchenProduct${index}"
                        list="kitchenProductList${index}"
                        value="${draft.productSearch || (state.items.find((item) => String(item.product_id) === String(draft.productId || '')) ? getDisplayProductName(state.items.find((item) => String(item.product_id) === String(draft.productId || '')).name) : '')}"
                        placeholder="Start typing product"
                        autocomplete="off"
                        oninput="updateKitchenDraftRow(${index}, 'productSearch', this.value)"
                        onchange="selectKitchenDraftProduct(${index}, this.value)"
                        style="padding:10px; border:1px solid #cbd5e0; border-radius:6px;"
                    >
                    <datalist id="kitchenProductList${index}">
                        ${kitchenItems.map((item) => {
                            const itemId = String(item.product_id);
                            const isTakenElsewhere = selectedProductIds.includes(itemId) && itemId !== String(draft.productId || '');
                            const label = getDisplayProductName(item.name);
                            return `<option value="${label}">${isTakenElsewhere ? `${label} (already selected)` : label}</option>`;
                        }).join('')}
                    </datalist>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value="${draft.qty}"
                        placeholder="Qty produced"
                        oninput="syncKitchenDraftQty(${index}, this.value)"
                        style="padding:10px; border:1px solid #cbd5e0; border-radius:6px;"
                    >
                    <button
                        class="btn"
                        onclick="removeKitchenDraftRow(${index})"
                        style="background:${state.kitchenDrafts.length > 1 ? '#fee2e2' : '#edf2f7'}; color:#7f1d1d; padding:10px 14px;"
                        ${state.kitchenDrafts.length === 1 ? 'disabled' : ''}
                    >
                        Remove
                    </button>
                </div>
            `).join('')}
        </div>
    `;
}

function syncKitchenDraftQty(index, value) {
    ensureKitchenDrafts();
    state.kitchenDrafts = state.kitchenDrafts.map((row, rowIndex) => (
        rowIndex === index
            ? { ...row, qty: value }
            : row
    ));
}

function renderKitchen() {
    const tbody = document.getElementById('kitchenBody');
    if (!tbody) return;
    const kitchenItems = getKitchenEligibleItems();
    tbody.innerHTML = kitchenItems.map((item) => `
        <tr>
            <td>${getDisplayProductName(item.name) || 'Unknown'}</td>
            <td style="font-weight:bold; color:blue;">${item.added_today || 0}</td>
        </tr>
    `).join('') || '<tr><td colspan="2">No production yet</td></tr>';
}

function shouldDisplaySalesItem(item) {
    const isRestaurantDirectItem = !isDirectSalesMode() && String(item?.sale_mode || '').toLowerCase() === 'direct';
    if (isRestaurantDirectItem && toNumber(item?.available_stock) > 0) {
        return true;
    }
    return toNumber(item?.bbf) > 0 || toNumber(item?.added_today) > 0;
}

function getSalesSectionKey(item) {
    if (isDirectSalesMode()) {
        const name = String(item?.name || '').trim();
        const category = String(item?.category || '').trim().toLowerCase();
        if (/wine/i.test(name)) return 'wine';
        if (category === 'bottled & canned') return 'bottled_can';
        return 'spirits';
    }

    const category = String(item?.category || '').trim().toLowerCase();
    if (category === 'food') return 'food';
    if (category === 'snacks') return 'snacks';
    if (category === 'drinks') return 'drinks';
    return category || 'other';
}

function getSalesSectionLabel(sectionKey) {
    const labels = {
        food: 'Food',
        snacks: 'Snacks',
        drinks: 'Drinks',
        bottled_can: 'Bottled & Can',
        spirits: 'Full Bottle & Shots',
        wine: 'Wine',
        other: 'Other'
    };

    return labels[sectionKey] || String(sectionKey || 'Other')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getBarSalesFamilyName(itemName) {
    return String(itemName || '')
        .replace(/\b\d+\s*ml\b/gi, '')
        .replace(/\bglass\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function getBarSalesVariantRank(item) {
    const name = String(item?.name || '').trim();
    if (/\b750\s*ml\b/i.test(name)) return 0;
    if (/\b1000\s*ml\b/i.test(name)) return 1;
    if (/\b375\s*ml\b/i.test(name)) return 2;
    if (/\b250\s*ml\b/i.test(name)) return 3;
    if (/\b200\s*ml\b/i.test(name)) return 4;
    if (/\b150\s*ml\b/i.test(name)) return 5;
    if (/\b30\s*ml\b/i.test(name)) return 6;
    if (/\bglass\b/i.test(name)) return 7;
    return 8;
}

function getSalesItemCategoryRank(category) {
    const normalized = String(category || '').trim().toLowerCase();
    if (normalized === 'food') return 0;
    return 1;
}

function compareSalesItems(left, right) {
    const sectionOrder = isDirectSalesMode()
        ? ['bottled_can', 'spirits', 'wine', 'other']
        : ['food', 'snacks', 'drinks', 'other'];
    const leftSection = getSalesSectionKey(left);
    const rightSection = getSalesSectionKey(right);
    const leftIndex = Math.max(sectionOrder.indexOf(leftSection), 0);
    const rightIndex = Math.max(sectionOrder.indexOf(rightSection), 0);
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;

    if (isDirectSalesMode() && leftSection === 'spirits' && rightSection === 'spirits') {
        const familyDiff = getBarSalesFamilyName(left?.name || '').localeCompare(
            getBarSalesFamilyName(right?.name || ''),
            undefined,
            { sensitivity: 'base' }
        );
        if (familyDiff !== 0) return familyDiff;

        const variantDiff = getBarSalesVariantRank(left) - getBarSalesVariantRank(right);
        if (variantDiff !== 0) return variantDiff;
    }

    return getDisplayProductName(left?.name || '').localeCompare(getDisplayProductName(right?.name || ''), undefined, { sensitivity: 'base' });
}

function recalculateSalesTotals() {
    let total = 0;
    document.querySelectorAll('#salesBody .sales-input').forEach((input) => {
        const productId = input.dataset.productId;
        const item = state.items.find((entry) => String(entry.product_id) === String(productId));
        const usesDirectMath = usesDirectStockMath(item);
        const maxQty = toNumber(input.dataset.maxQty);
        const rawValue = String(input.value ?? '').trim();
        const hasEntry = rawValue !== '';
        const safeValue = hasEntry ? clampClosingQty(rawValue, maxQty) : 0;
        if (hasEntry && String(input.value) !== String(safeValue)) {
            input.value = safeValue;
        }
        const soldQty = usesDirectMath
            ? Math.max(
                0,
                toNumber(input.dataset.openingQty) +
                toNumber(input.dataset.producedQty) -
                toNumber(input.dataset.issuedQty) -
                safeValue
            )
            : calculateSoldQty({
                openingQty: input.dataset.openingQty,
                producedQty: input.dataset.producedQty,
                closingQty: safeValue
            });
        const amount = soldQty * toNumber(item?.price);

        const soldCell = document.getElementById(`sold_${productId}`);
        const amtCell = document.getElementById(`amt_${productId}`);
        if (soldCell) soldCell.innerText = formatQuantity(soldQty);
        if (amtCell) amtCell.innerText = amount.toLocaleString();

        if (item) {
            item.sold = hasEntry ? soldQty : 0;
            item.closing_stock = hasEntry ? safeValue : null;
        }

        if (hasEntry) {
            state.salesDrafts[String(productId)] = safeValue;
        } else {
            delete state.salesDrafts[String(productId)];
        }

        total += hasEntry ? amount : 0;
    });

    state.currentShiftTotal = total;
    const totalDisplay = document.getElementById('totalSalesDisplay');
    if (totalDisplay) totalDisplay.innerText = `KES ${total.toLocaleString()}`;
    const totalVal = document.getElementById('totalSalesVal');
    if (totalVal) totalVal.innerText = formatMoney(total);
    window.calcRecon();
}

function renderSales() {
    const body = document.getElementById('salesBody');
    if (!body) return;
    updateSalesTableHeaders();

    const visibleItems = (state.items || [])
        .filter((item) => shouldDisplaySalesItem(item))
        .sort(compareSalesItems);

    if (!visibleItems.length) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px;">No items with opening stock or added stock for this shift.</td></tr>';
        return;
    }

      let previousSectionKey = '';
      body.innerHTML = visibleItems.map((item) => {
          const sectionKey = getSalesSectionKey(item);
          const sectionMarkup = sectionKey !== previousSectionKey
              ? `
                  <tr class="sales-section-row" data-section="${sectionKey}">
                      <td colspan="7" style="padding:8px 14px; background:#e8eef6; color:#274c77; font-weight:800; text-transform:uppercase; letter-spacing:0.04em; border-top:1px solid #d7e2ef; border-bottom:1px solid #d7e2ef;">
                          ${getSalesSectionLabel(sectionKey)}
                      </td>
                  </tr>
              `
              : '';
          previousSectionKey = sectionKey;
          const usesDirectMath = usesDirectStockMath(item);
          const totalAvailable = usesDirectMath
              ? toNumber(item.available_stock ?? (toNumber(item.bbf) + toNumber(item.added_today)))
              : toNumber(item.bbf) + toNumber(item.added_today);
          const explicitValue = hasExplicitClosingDraft(item.product_id)
              ? state.salesDrafts[String(item.product_id)]
              : '';
          return `
              ${sectionMarkup}
              <tr>
                  <td style="padding:6px 14px; font-weight:500;">${getDisplayProductName(item.name)}</td>
                  <td style="text-align:left;">
                      <span style="display:inline-flex; align-items:center; min-width:48px; padding:0; color:#1d4ed8; font-weight:700;">
                          ${usesDirectMath ? formatQuantity(item.bbf) : item.bbf}
                      </span>
                  </td>
                  <td style="text-align:left;">
                      ${usesDirectMath ? `
                          <span style="display:inline-flex; align-items:center; min-width:48px; padding:0; color:#047857; font-weight:700;">
                              ${formatQuantity(item.added_today)}
                          </span>
                      ` : `
                          <span style="display:inline-flex; align-items:center; min-width:48px; padding:0; color:#047857; font-weight:700;">
                              ${item.added_today}
                          </span>
                      `}
                  </td>
                  <td style="text-align:left;">
                      <input type="number"
                          class="sales-input"
                          placeholder="${usesDirectMath ? 'Bal Qty' : 'Insert qty'}"
                        oninput="calcSalesRow(this, ${totalAvailable}, ${item.price})"
                        min="0"
                        step="0.01"
                        max="${totalAvailable}"
                        data-id="${item.product_id}"
                        data-product-id="${item.product_id}"
                        data-shift-row-id="${item.id || ''}"
                        data-opening-qty="${item.bbf}"
                        data-produced-qty="${item.added_today}"
                        data-issued-qty="${usesDirectMath ? toNumber(item.issued_qty) : 0}"
                        data-max-qty="${totalAvailable}"
                        value="${explicitValue}"
                        style="display:block; width:120px; padding:6px; border:1px solid #7092ae; border-radius:4px; margin:0;">
                </td>
                <td id="sold_${item.product_id}" style="font-weight:bold; text-align:left; color: #2c3e50;">${formatQuantity(item.sold || 0)}</td>
                <td style="font-weight:600; text-align:left; color:#2c3e50;">${formatMoney(item.price || 0)}</td>
                <td id="amt_${item.product_id}" class="row-amt" style="font-weight:bold; text-align:left;">0</td>
            </tr>
        `;
    }).join('');

    recalculateSalesTotals();
}

function renderFinishedProducts() {
    const tbody = document.getElementById('finishedProductBody');
    if (!tbody) return;
    const canManageProducts = hasPermission(state.permissions, PERMISSIONS.MANAGE_PRODUCTS);

    if (!state.items.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px;">No products found.</td></tr>';
        applyMasterPageModes();
        return;
    }

    tbody.innerHTML = state.items.map((item) => `
        <tr>
            <td>${getDisplayProductName(item.name)}</td>
            <td>${item.category || '-'}</td>
            <td>${toNumber(item.price).toFixed(2)}</td>
            <td style="text-align: right;">
                ${canManageProducts ? `
                    <button class="btn" style="background:#edf2f7; margin-right:8px;" onclick="editSellingProduct('${item.product_id}')">Edit</button>
                    <button class="btn" style="background:#e74c3c; color:white;" onclick="deleteSellingProduct('${item.product_id}')">Deactivate</button>
                ` : '--'}
            </td>
        </tr>
    `).join('');

    applyMasterPageModes();
}

function renderExpenseRows() {
    const body = document.getElementById('expenseLinesBody');
    if (!body) return;

    ensureFinanceDrafts();
    body.innerHTML = state.financeDraft.expenseLines.map((line, index) => {
        const lineTotal = getExpenseLineAmount(line);
        return `
            <tr>
                <td><input type="text" id="expenseDescription${index}" name="expenseDescription${index}" value="${line.description || ''}" placeholder="e.g. Packaging" oninput="updateExpenseLine(${index}, 'description', this.value)"></td>
                <td><input class="no-spinner" type="number" id="expenseQty${index}" name="expenseQty${index}" min="0" step="1" value="${line.qty || ''}" placeholder="0" oninput="updateExpenseLine(${index}, 'qty', this.value)"></td>
                <td><input class="no-spinner" type="number" id="expenseUnitCost${index}" name="expenseUnitCost${index}" min="0" step="0.01" value="${line.unitCost || ''}" placeholder="0.00" oninput="updateExpenseLine(${index}, 'unitCost', this.value)"></td>
                <td style="font-weight:600; text-align:right;">${formatMoney(lineTotal)}</td>
                <td><input type="text" id="expenseNotes${index}" name="expenseNotes${index}" value="${line.notes || ''}" placeholder="Optional note" oninput="updateExpenseLine(${index}, 'notes', this.value)"></td>
                <td style="text-align:right;"><button class="btn" onclick="removeExpenseLine(${index})" ${state.financeDraft.expenseLines.length === 1 ? 'disabled' : ''}>Remove</button></td>
            </tr>
        `;
    }).join('');
}

function renderDebtRows(type) {
    const isPaid = type === 'paid';
    const body = document.getElementById(isPaid ? 'debtPaidBody' : 'debtGivenBody');
    if (!body) return;

    ensureFinanceDrafts();
    const lines = isPaid ? state.financeDraft.debtPaidLines : state.financeDraft.debtGivenLines;
    body.innerHTML = lines.map((line, index) => `
        <tr>
            <td><input type="text" id="${type}DebtClient${index}" name="${type}DebtClient${index}" value="${line.clientName || ''}" placeholder="Client name" style="width:100%;" oninput="updateDebtLine('${type}', ${index}, 'clientName', this.value)"></td>
            <td><input type="text" id="${type}DebtPhone${index}" name="${type}DebtPhone${index}" value="${line.phone || ''}" placeholder="Phone" style="width:100%;" oninput="updateDebtLine('${type}', ${index}, 'phone', this.value)"></td>
            <td><input class="no-spinner" type="number" id="${type}DebtAmount${index}" name="${type}DebtAmount${index}" min="0" step="0.01" value="${line.amount || ''}" placeholder="0.00" style="width:100%;" oninput="updateDebtLine('${type}', ${index}, 'amount', this.value)"></td>
            <td><input type="text" id="${type}DebtNotes${index}" name="${type}DebtNotes${index}" value="${line.notes || ''}" placeholder="Reason / note" style="width:100%;" oninput="updateDebtLine('${type}', ${index}, 'notes', this.value)"></td>
            <td style="text-align:right;"><button class="btn" onclick="removeDebtLine('${type}', ${index})" ${lines.length === 1 ? 'disabled' : ''}>Remove</button></td>
        </tr>
    `).join('');
}

function renderFinanceLineItems() {
    renderExpenseRows();
    renderDebtRows('given');
    renderDebtRows('paid');
}

function getStoreStockStatus(material) {
    const currentStock = toNumber(material.stock_level ?? material.current_stock);
    const reorderLevel = toNumber(material.reorder_level);

    if (reorderLevel <= 0) {
        return {
            label: 'No reorder level',
            background: '#f8fafc',
            color: '#475569'
        };
    }

    if (currentStock <= 0) {
        return {
            label: 'Out of stock',
            background: '#fee2e2',
            color: '#b91c1c'
        };
    }

    if (currentStock <= reorderLevel) {
        return {
            label: 'Reorder now',
            background: '#fef3c7',
            color: '#b45309'
        };
    }

    return {
        label: 'OK',
        background: '#dcfce7',
        color: '#166534'
    };
}

function getBranchName(branchId) {
    const branch = state.branches.find((entry) => String(entry.id) === String(branchId));
    return formatBranchDisplayName(branch);
}

function getCurrentBranchName() {
    const currentBranchId = state.branchId || state.user?.branch_id || state.user?.default_branch_id || '';
    return getBranchName(currentBranchId) || currentBranchId || '--';
}

function getScopeForBranch(branchId = '') {
    const scope = getScope();
    if (!branchId) return scope;
    return {
        ...scope,
        branchId,
        useBranchScope: true
    };
}

function isDirectSalesBranch(branchId = '') {
    const branch = (state.branches || []).find((entry) => String(entry.id) === String(branchId));
    if (!branch) return false;
    const operatingMode = String(branch.operating_mode || '').trim().toUpperCase();
    const code = String(branch.code || '').trim().toUpperCase();
    return operatingMode === 'DIRECT_SALES' || code.includes('BAR');
}

function formatShiftRecallDate(value) {
    if (!value) return '--';
    return formatLongDate(value);
}

function formatShiftRecallDateTime(value) {
    if (!value) return '--';
    return formatLongDateTime(value);
}

function buildShiftRecallSummaryCards(shift, shiftLabel) {
    const mpesaIncome = calculateMpesaIncome(shift.mpesa_float, shift.mpesa_closing, shift.mpesa_withdrawals);
    const accountedIncome = calculateAccountedIncome({
        cashAtHand: shift.cash_at_hand,
        mpesaIncome,
        totalExpenses: shift.total_expenses,
        debtGiven: shift.total_debts,
        prevDebtsPaid: shift.debts_collected
    });
    const variance = calculateVariance(shift.total_sales, accountedIncome);

    const summaryItems = [
        { label: 'Branch', value: getBranchName(shift.branch_id) || '--' },
        { label: 'Business Date', value: formatShiftRecallDate(shift.created_at) },
        { label: 'Shift', value: shiftLabel || '--' },
        { label: 'Closed By', value: shift.closed_by || 'Staff' },
        { label: 'Total Sales', value: `KES ${formatMoney(shift.total_sales)}` },
        { label: 'M-Pesa Income', value: `KES ${formatMoney(mpesaIncome)}` },
        { label: 'Cash at Hand', value: `KES ${formatMoney(shift.cash_at_hand)}` },
        { label: 'Expenses', value: `KES ${formatMoney(shift.total_expenses)}` },
        { label: 'Debt Given', value: `KES ${formatMoney(shift.total_debts)}` },
        { label: 'Debt Paid', value: `KES ${formatMoney(shift.debts_collected)}` },
        { label: 'Variance', value: `KES ${formatMoney(variance)}`, valueStyle: getVarianceDisplayStyle(variance) },
        { label: 'Recorded At', value: formatShiftRecallDateTime(shift.created_at) }
    ];

    const notesMarkup = String(shift.reconciliation_notes || '').trim()
        ? `
            <div style="margin-bottom:20px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
                <div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">Reconciliation Notes</div>
                <div style="font-size:14px; color:#1f2937; white-space:pre-wrap;">${escapeHtml(String(shift.reconciliation_notes || '').trim())}</div>
            </div>
        `
        : '';

    return `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px; margin-bottom:20px;">
            ${summaryItems.map((item) => `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;">
                    <div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">${item.label}</div>
                    <div style="font-size:15px; ${item.valueStyle || 'font-weight:700; color:#1f2937;'}">${item.value}</div>
                </div>
            `).join('')}
        </div>
        ${notesMarkup}
    `;
}

function buildShiftRecallRows(shiftInventoryRows, products, options = {}) {
    const productMap = new Map((products || []).map((product) => [String(product.id), product]));
    const previousInventoryMap = new Map((options.previousInventoryRows || []).map((row) => [String(row.product_id), row]));
    const nextInventoryMap = new Map((options.nextInventoryRows || []).map((row) => [String(row.product_id), row]));
    const measuredIssueMap = (options.barIssueRows || []).reduce((map, issue) => {
        const key = String(issue.target_product_name || '').trim().toLowerCase();
        if (!key) return map;
        map.set(key, (map.get(key) || 0) + toNumber(issue.qty_added_target));
        return map;
    }, new Map());
    const useDirectSalesFallback = options.useDirectSalesFallback === true;

    return (shiftInventoryRows || [])
        .map((row) => {
            const product = productMap.get(String(row.product_id));
            const productName = product?.name || `Unknown Product (${String(row.product_id || '').slice(0, 8)})`;
            const displayName = getDisplayProductName(productName);
            const savedUnitPrice = toNumber(row.unit_price);
            const savedLineTotal = toNumber(row.line_total);
            const price = savedUnitPrice > 0 ? savedUnitPrice : toNumber(product?.price);
            let opening = toNumber(row.bbf);
            let added = toNumber(row.added_today);
            let closing = toNumber(row.close_qty);
            const soldQty = toNumber(row.sold_qty);

            if (useDirectSalesFallback) {
                if (opening === 0) {
                    opening = toNumber(previousInventoryMap.get(String(row.product_id))?.close_qty);
                }
                if (closing === 0) {
                    closing = toNumber(nextInventoryMap.get(String(row.product_id))?.bbf);
                }
                if (added === 0) {
                    added = toNumber(measuredIssueMap.get(String(productName || '').trim().toLowerCase()));
                }
            }

            return {
                item: displayName,
                opening,
                added,
                closing,
                sold: soldQty,
                price,
                total: (savedLineTotal > 0 || soldQty === 0) ? savedLineTotal : soldQty * price
            };
        })
        .sort((left, right) => left.item.localeCompare(right.item));
}

function renderShiftRecallTable(rows, options = {}) {
    if (!rows.length) {
        return '<div style="padding:20px; color:#64748b; text-align:center; border:1px solid #e2e8f0; border-radius:10px;">No item rows were found for this shift.</div>';
    }

    const totalSales = toNumber(options.savedTotalSales) || rows.reduce((sum, row) => sum + toNumber(row.total), 0);

    return `
        <div style="overflow-x:auto;">
            <table class="shift-recall-table" style="width:100%; border-collapse:collapse; background:white; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
                <thead>
                    <tr>
                        <th style="padding:12px 14px; text-align:left;">Item</th>
                        <th style="padding:12px 14px; text-align:right;">Opening</th>
                        <th style="padding:12px 14px; text-align:right;">Added</th>
                        <th style="padding:12px 14px; text-align:right;">Closing</th>
                        <th style="padding:12px 14px; text-align:right;">Sold</th>
                        <th style="padding:12px 14px; text-align:right;">Price</th>
                        <th style="padding:12px 14px; text-align:right;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr style="border-bottom:1px solid #e5e7eb;">
                            <td style="padding:10px 14px; font-weight:600;">${row.item}</td>
                            <td style="padding:10px 14px; text-align:right;">${formatQuantity(row.opening)}</td>
                            <td style="padding:10px 14px; text-align:right;">${formatQuantity(row.added)}</td>
                            <td style="padding:10px 14px; text-align:right;">${formatQuantity(row.closing)}</td>
                            <td style="padding:10px 14px; text-align:right;">${formatQuantity(row.sold)}</td>
                            <td style="padding:10px 14px; text-align:right;">${formatMoney(row.price)}</td>
                            <td style="padding:10px 14px; text-align:right; font-weight:700;">${formatMoney(row.total)}</td>
                        </tr>
                    `).join('')}
                    <tr style="background:#f8fafc; font-weight:700;">
                        <td style="padding:12px 14px;">TOTAL</td>
                        <td style="padding:12px 14px;"></td>
                        <td style="padding:12px 14px;"></td>
                        <td style="padding:12px 14px;"></td>
                        <td style="padding:12px 14px;"></td>
                        <td style="padding:12px 14px;"></td>
                        <td style="padding:12px 14px; text-align:right;">${formatMoney(totalSales)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function getTransferDestinationBranches() {
    const currentBranchId = state.branchId || state.user?.branch_id || state.user?.default_branch_id || '';
    return (state.branches || []).filter((branch) =>
        branch.is_active !== false && String(branch.id) !== String(currentBranchId)
    );
}

function getBarIssueSourceMaterials() {
    return (state.rawMaterials || [])
        .filter((material) => material && String(material.name || '').trim())
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
}

function getBarIssueTargetProducts() {
    return (state.items || [])
        .filter((item) => item && String(item.name || '').trim())
        .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
}

function getBarIssueConversion(sourceMaterialName, targetProductName) {
    const sourceMaterial = resolveDirectSalesMaterial(sourceMaterialName, state.rawMaterials);
    const recipeRow = (state.recipeMatrix || []).find((recipe) =>
        entityNamesMatch(recipe.finished_item_name, targetProductName) &&
        entityNamesMatch(recipe.material_name, sourceMaterialName)
    );

    if (!sourceMaterial || !recipeRow) return null;

    const sourceConversion = Math.max(toNumber(sourceMaterial.conversion_factor), 1);
    const recipeQty = toNumber(recipeRow.qty_per_unit);
    if (recipeQty <= 0) return null;

    return {
        sourceMaterial,
        recipeRow,
        addedUnitsPerIssueUnit: sourceConversion / recipeQty
    };
}

function renderStoreStockLevels() {
    const body = document.getElementById('storeStockLevelsBody');
    const actionHeader = document.getElementById('storeStockLevelsActionHeader');
    if (!body) return;
    const showAdjustAction = canAdjustStockLevels();
    if (actionHeader) {
        actionHeader.classList.toggle('hidden', !showAdjustAction);
    }

    const searchValue = String(document.getElementById('stockLevelsSearch')?.value || '').trim().toLowerCase();
    const rows = (state.rawMaterials || []).filter((material) =>
        !searchValue || String(material.name || '').toLowerCase().includes(searchValue)
    );

    if (!rows.length) {
        body.innerHTML = `<tr><td colspan="${showAdjustAction ? 8 : 7}" style="text-align:center; padding:24px; color:#64748b;">No raw materials match this view.</td></tr>`;
        return;
    }

    body.innerHTML = rows.map((material) => {
        const currentStock = toNumber(material.stock_level ?? material.current_stock);
        const reorderLevel = material.reorder_level ?? '';
        const status = getStoreStockStatus(material);

        return `
            <tr>
                <td>${material.name}</td>
                <td>${material.store_unit || '--'}</td>
                <td style="font-weight:700;">${formatQuantity(currentStock)} ${material.store_unit || ''}</td>
                <td>${material.buy_unit || '--'}</td>
                <td>${formatMoney(material.price)}</td>
                <td>${reorderLevel !== '' ? `${formatQuantity(reorderLevel)} ${material.store_unit || ''}`.trim() : '--'}</td>
                <td>
                    <span style="display:inline-block; padding:6px 10px; border-radius:999px; background:${status.background}; color:${status.color}; font-weight:700; font-size:12px;">
                        ${status.label}
                    </span>
                </td>
                ${showAdjustAction ? `
                    <td style="text-align:right;">
                        <button class="btn" type="button" onclick="adjustStoreStockLevel('${material.id}')">Adjust</button>
                    </td>
                ` : ''}
            </tr>
        `;
    }).join('');
}

function renderSupplyReceiptsView() {
    const batchBody = document.getElementById('supplyReceiptBatchBody');
    const historyBody = document.getElementById('supplyReceiptsBody');
    const batchTotalNode = document.getElementById('supplyReceiptBatchTotal');
    const historyTotalNode = document.getElementById('supplyReceiptHistoryTotal');
    if (!batchBody || !historyBody) return;

    ensureSupplyReceiptDrafts();
    const selectedItemIds = state.supplyReceiptDrafts
        .map((draft) => String(draft.supplyItemId || ''))
        .filter(Boolean);
    const categories = getSupplyCategories();

    batchBody.innerHTML = state.supplyReceiptDrafts.map((draft, index) => {
        const selectedItem = (state.supplyItems || []).find((item) => String(item.id) === String(draft.supplyItemId || ''));
        const inputValue = draft.itemSearch || (selectedItem ? getDisplaySupplyItemName(selectedItem.name) : '');
        const categoryValue = draft.category || selectedItem?.category || 'General Supplies';
        const buyUnitValue = draft.buyUnit || selectedItem?.buy_unit || '';
        const options = (state.supplyItems || []).map((item) => {
            const itemId = String(item.id);
            const isSelected = itemId === String(draft.supplyItemId || '');
            const disabled = !isSelected && selectedItemIds.includes(itemId);
            const label = getDisplaySupplyItemName(item.name);
            return `<option value="${label}">${disabled ? `${label} (already selected)` : label}</option>`;
        }).join('');

        return `
            <tr>
                <td>
                    <input
                        type="text"
                        id="supplyReceiptItem${index}"
                        name="supplyReceiptItem${index}"
                        list="supplyReceiptItemList${index}"
                        value="${inputValue}"
                        placeholder="Start typing supply item"
                        autocomplete="off"
                        oninput="updateSupplyReceiptDraft(${index}, 'itemSearch', this.value)"
                        onchange="selectSupplyReceiptItem(${index}, this.value)">
                    <datalist id="supplyReceiptItemList${index}">
                        ${options}
                    </datalist>
                </td>
                <td>
                    <input
                        type="text"
                        id="supplyReceiptCategory${index}"
                        name="supplyReceiptCategory${index}"
                        list="supplyReceiptCategoryList${index}"
                        value="${categoryValue}"
                        placeholder="Category"
                        oninput="updateSupplyReceiptDraft(${index}, 'category', this.value)">
                    <datalist id="supplyReceiptCategoryList${index}">
                        ${categories.map((category) => `<option value="${category}"></option>`).join('')}
                    </datalist>
                </td>
                <td>
                    <input type="text" id="supplyReceiptBuyUnit${index}" name="supplyReceiptBuyUnit${index}" value="${buyUnitValue}" placeholder="e.g. pack" oninput="updateSupplyReceiptDraft(${index}, 'buyUnit', this.value)">
                </td>
                <td>
                    <input type="number" id="supplyReceiptQty${index}" name="supplyReceiptQty${index}" min="0" step="0.01" value="${draft.qty || ''}" placeholder="0.00" oninput="updateSupplyReceiptDraft(${index}, 'qty', this.value)">
                </td>
                <td>
                    <input type="number" id="supplyReceiptTotalCost${index}" name="supplyReceiptTotalCost${index}" min="0" step="0.01" value="${draft.totalReceivedCost || ''}" placeholder="0.00" oninput="updateSupplyReceiptDraft(${index}, 'totalReceivedCost', this.value)">
                </td>
                <td>
                    <input type="text" id="supplyReceiptNotes${index}" name="supplyReceiptNotes${index}" value="${draft.notes || ''}" placeholder="Optional note" oninput="updateSupplyReceiptDraft(${index}, 'notes', this.value)">
                </td>
                <td style="text-align:right;">
                    <button class="btn" type="button" onclick="removeSupplyReceiptLine(${index})" ${state.supplyReceiptDrafts.length === 1 ? 'disabled' : ''}>Remove</button>
                </td>
            </tr>
        `;
    }).join('');

    const batchTotal = state.supplyReceiptDrafts.reduce((sum, draft) => sum + toNumber(draft.totalReceivedCost), 0);
    if (batchTotalNode) {
        batchTotalNode.innerText = `Supplies Receipt Total: KES ${formatMoney(batchTotal)}`;
    }

    const historyTotal = (state.supplyReceipts || []).reduce((sum, row) => sum + toNumber(row.total_received_cost), 0);
    if (historyTotalNode) {
        historyTotalNode.innerText = `Shift Supplies Total: KES ${formatMoney(historyTotal)}`;
    }

    historyBody.innerHTML = state.supplyReceipts.length ? state.supplyReceipts.map((row) => `
        <tr>
            <td>${formatDateDisplay(row.created_at)}</td>
            <td>${getDisplaySupplyItemName(row.item_name)}</td>
            <td>${row.category || '--'}</td>
            <td>${formatQuantity(row.qty_received)} ${row.buy_unit || ''}</td>
            <td>${formatMoney(row.total_received_cost)}</td>
            <td>${formatMoney(row.unit_cost)}</td>
            <td>${row.received_by || '--'}</td>
            <td>${row.notes || '--'}</td>
        </tr>
    `).join('') : '<tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b;">No supplies received in this shift yet.</td></tr>';
}

async function prepareStockTransferView() {
    if (!state.branchId && state.user?.id) {
        const { data: latestProfile, error: profileError } = await repositories.getProfile(state.user.id);
        if (profileError) throw profileError;
        if (latestProfile) {
            setSessionContext(latestProfile);
            applyRoleAccess();
        }
    }

    if (!state.branches.length) {
        await loadBranches();
    }

    if (!state.rawMaterials.length) {
        await loadRawMaterials();
    }

    await loadStockTransfers();
    renderStockTransferView();
}

function setStocksView(view) {
    const isLevels = view === 'levels';
    const isIssues = view === 'issues';
    const isTransfers = view === 'transfers';
    const isSupplies = view === 'supplies';
    const receiptsView = document.getElementById('stocksReceiptsView');
    const suppliesView = document.getElementById('stocksSuppliesView');
    const levelsView = document.getElementById('stocksLevelsView');
    const issuesView = document.getElementById('stocksIssuesView');
    const transfersView = document.getElementById('stocksTransfersView');
    const receiptsButton = document.getElementById('stocksViewReceiptsBtn');
    const suppliesButton = document.getElementById('stocksViewSuppliesBtn');
    const levelsButton = document.getElementById('stocksViewLevelsBtn');
    const issuesButton = document.getElementById('stocksViewIssuesBtn');
    const transfersButton = document.getElementById('stocksViewTransfersBtn');

    if (receiptsView) receiptsView.classList.toggle('hidden', isLevels || isIssues || isTransfers || isSupplies);
    if (suppliesView) suppliesView.classList.toggle('hidden', !isSupplies);
    if (levelsView) levelsView.classList.toggle('hidden', !isLevels);
    if (issuesView) issuesView.classList.toggle('hidden', !isIssues);
    if (transfersView) transfersView.classList.toggle('hidden', !isTransfers);

    if (receiptsButton) {
        const active = !isLevels && !isTransfers && !isSupplies;
        receiptsButton.style.background = active ? '#7092ae' : '#edf2f7';
        receiptsButton.style.color = active ? 'white' : '#2d3748';
    }

    if (suppliesButton) {
        suppliesButton.style.background = isSupplies ? '#7092ae' : '#edf2f7';
        suppliesButton.style.color = isSupplies ? 'white' : '#2d3748';
    }

    if (levelsButton) {
        levelsButton.style.background = isLevels ? '#7092ae' : '#edf2f7';
        levelsButton.style.color = isLevels ? 'white' : '#2d3748';
    }

    if (issuesButton) {
        issuesButton.classList.toggle('hidden', !isDirectSalesMode());
        issuesButton.style.background = isIssues ? '#7092ae' : '#edf2f7';
        issuesButton.style.color = isIssues ? 'white' : '#2d3748';
    }

    if (transfersButton) {
        transfersButton.style.background = isTransfers ? '#7092ae' : '#edf2f7';
        transfersButton.style.color = isTransfers ? 'white' : '#2d3748';
    }

    if (isLevels) {
        renderStoreStockLevels();
    }

    if (isSupplies) {
        renderSupplyReceiptsView();
    }

    if (isIssues) {
        renderBarIssueView();
    }

    if (isTransfers) {
        renderStockTransferView();
    }
}

function renderBarIssueView() {
    const batchBody = document.getElementById('barIssueBatchBody');
    const historyBody = document.getElementById('barIssueHistoryBody');
    if (!batchBody || !historyBody) return;

    ensureBarIssueDrafts();
    const sources = getBarIssueSourceMaterials();
    const targets = getBarIssueTargetProducts();
    const canDelete = canDeleteStockHistory();

    batchBody.innerHTML = state.barIssueDrafts.map((draft, index) => {
        const selectedSource = sources.find((material) => String(material.id) === String(draft.sourceMaterialId || ''));
        const selectedTarget = targets.find((item) => String(item.product_id) === String(draft.targetProductId || ''));
        const sourceInputValue = draft.sourceMaterialSearch || (selectedSource ? getDisplayMaterialName(selectedSource.name) : '');
        const targetInputValue = draft.targetProductSearch || (selectedTarget ? getDisplayProductName(selectedTarget.name) : '');
        const conversion = selectedSource && selectedTarget
            ? getBarIssueConversion(selectedSource.name, selectedTarget.name)
            : null;
        const availableQty = selectedSource ? getSellableUnitsForMaterial(selectedSource) : 0;
        const issueQty = toNumber(draft.qty);
        const addedQty = conversion ? issueQty * conversion.addedUnitsPerIssueUnit : 0;

        return `
            <tr>
                <td>
                    <input
                        type="text"
                        id="barIssueSource${index}"
                        name="barIssueSource${index}"
                        list="barIssueSourceList${index}"
                        value="${sourceInputValue}"
                        placeholder="Start typing source stock item"
                        autocomplete="off"
                        oninput="updateBarIssueDraftRow(${index}, 'sourceMaterialSearch', this.value)"
                        onchange="selectBarIssueSource(${index}, this.value)">
                    <datalist id="barIssueSourceList${index}">
                        ${sources.map((material) => `<option value="${getDisplayMaterialName(material.name)}"></option>`).join('')}
                    </datalist>
                </td>
                <td>
                    <input
                        type="text"
                        id="barIssueTarget${index}"
                        name="barIssueTarget${index}"
                        list="barIssueTargetList${index}"
                        value="${targetInputValue}"
                        placeholder="Start typing measured item"
                        autocomplete="off"
                        oninput="updateBarIssueDraftRow(${index}, 'targetProductSearch', this.value)"
                        onchange="selectBarIssueTarget(${index}, this.value)">
                    <datalist id="barIssueTargetList${index}">
                        ${targets.map((item) => `<option value="${getDisplayProductName(item.name)}"></option>`).join('')}
                    </datalist>
                </td>
                <td>
                    <input type="number" id="barIssueQty${index}" name="barIssueQty${index}" min="0" step="0.01" value="${draft.qty || ''}" placeholder="0.00" oninput="updateBarIssueDraftRow(${index}, 'qty', this.value)">
                </td>
                <td style="font-weight:700; color:#166534;">
                    ${selectedSource ? `${formatQuantity(availableQty)} ${selectedSource.buy_unit || 'unit'}${availableQty === 1 ? '' : 's'}` : '--'}
                </td>
                <td>
                    ${conversion
                        ? `<span style="display:inline-block; min-width:96px; padding:6px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-weight:700; text-align:center;">${formatQuantity(addedQty)} units</span>`
                        : '<span style="color:#94a3b8;">--</span>'}
                </td>
                <td>
                    <input type="text" id="barIssueNotes${index}" name="barIssueNotes${index}" value="${draft.notes || ''}" placeholder="Optional note" oninput="updateBarIssueDraftRow(${index}, 'notes', this.value)">
                </td>
                <td style="text-align:right;">
                    <button class="btn" type="button" onclick="removeBarIssueLine(${index})" ${state.barIssueDrafts.length === 1 ? 'disabled' : ''}>Remove</button>
                </td>
            </tr>
        `;
    }).join('');

    if (!state.barStockIssues.length) {
        historyBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b;">No issue history recorded for this branch yet.</td></tr>';
        return;
    }

    historyBody.innerHTML = state.barStockIssues.map((issue) => `
        <tr>
            <td>${formatDateDisplay(issue.created_at)}</td>
            <td>${getDisplayMaterialName(issue.source_material_name)}</td>
            <td>${getDisplayProductName(issue.target_product_name)}</td>
            <td>${formatQuantity(issue.qty_issued_source)} ${issue.source_buy_unit || ''}</td>
            <td>${formatQuantity(issue.qty_added_target)} ${issue.target_unit || 'units'}</td>
            <td>${issue.created_by || '--'}</td>
            <td>${issue.notes || '--'}</td>
            <td style="text-align:right;">
                ${canDelete && isRecordInCurrentShiftWindow(issue)
                    ? `<button class="btn" style="background:#e74c3c; color:white;" onclick="deleteBarIssueHistory('${issue.id}')">Delete</button>`
                    : '--'}
            </td>
        </tr>
    `).join('');
}

function renderStockTransferView() {
    ensureStockTransferDrafts();
    const destinationBranches = getTransferDestinationBranches();

    if (!state.stockTransferDestinationBranchId && destinationBranches.length === 1) {
        state.stockTransferDestinationBranchId = destinationBranches[0].id;
    }

    const destinationSelect = document.getElementById('stockTransferToBranch');
    const sourceBranchNode = document.getElementById('stockTransferFromBranchLabel');
    const batchBody = document.getElementById('stockTransferBatchBody');
    const historyBody = document.getElementById('stockTransfersBody');
    const canDelete = canDeleteStockHistory();

    if (sourceBranchNode) {
        sourceBranchNode.innerText = getCurrentBranchName() || '--';
    }

    if (destinationSelect) {
        const options = destinationBranches
            .map((branch) => `<option value="${branch.id}" ${String(branch.id) === String(state.stockTransferDestinationBranchId || '') ? 'selected' : ''}>${branch.name}</option>`)
            .join('');

        destinationSelect.innerHTML = `<option value="">-- Select destination branch --</option>${options}`;
    }

    if (batchBody) {
        const selectedMaterialIds = state.stockTransferDrafts
            .map((draft) => String(draft.materialId || ''))
            .filter(Boolean);

        batchBody.innerHTML = state.stockTransferDrafts.map((draft, index) => {
            const selectedMaterial = state.rawMaterials.find((material) => String(material.id) === String(draft.materialId || ''));
            const selectedDisplayName = selectedMaterial ? getDisplayMaterialName(selectedMaterial.name) : '';
            const inputValue = draft.materialSearch || selectedDisplayName;
            const options = (state.rawMaterials || []).map((material) => {
                const materialId = String(material.id);
                const isSelected = materialId === String(draft.materialId || '');
                const disabled = !isSelected && selectedMaterialIds.includes(materialId);
                const label = getDisplayMaterialName(material.name);
                return `<option value="${label}">${disabled ? `${label} (already selected)` : label}</option>`;
            }).join('');

            const available = selectedMaterial ? toNumber(selectedMaterial.stock_level ?? selectedMaterial.current_stock) : 0;

            return `
                <tr>
                    <td>
                        <input
                            type="text"
                            id="stockTransferMaterial${index}"
                            name="stockTransferMaterial${index}"
                            list="stockTransferMaterialList${index}"
                            value="${inputValue}"
                            placeholder="Start typing item"
                            autocomplete="off"
                            oninput="updateStockTransferDraftRow(${index}, 'materialSearch', this.value)"
                            onchange="selectStockTransferMaterial(${index}, this.value)">
                        <datalist id="stockTransferMaterialList${index}">
                            ${options}
                        </datalist>
                    </td>
                    <td>
                        <div style="display:inline-block; min-width:72px; padding:6px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-weight:700; text-align:center;">
                            ${selectedMaterial?.store_unit || '--'}
                        </div>
                    </td>
                    <td style="font-weight:700; color:#166534;">
                        ${selectedMaterial ? `${formatQuantity(available)} ${selectedMaterial.store_unit || ''}`.trim() : '--'}
                    </td>
                    <td>
                        <input type="number" id="stockTransferQty${index}" name="stockTransferQty${index}" min="0" step="0.01" value="${draft.qty || ''}" placeholder="0.00" oninput="updateStockTransferDraftRow(${index}, 'qty', this.value)">
                    </td>
                    <td>
                        <input type="text" id="stockTransferNotes${index}" name="stockTransferNotes${index}" value="${draft.notes || ''}" placeholder="Optional audit note" oninput="updateStockTransferDraftRow(${index}, 'notes', this.value)">
                    </td>
                    <td style="text-align:right;">
                        <button class="btn" type="button" onclick="removeStockTransferLine(${index})" ${state.stockTransferDrafts.length === 1 ? 'disabled' : ''}>Remove</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    if (!historyBody) return;

    const currentBranchId = state.branchId || state.user?.branch_id || state.user?.default_branch_id || '';
    const rows = (state.stockTransfers || []).filter((row) =>
        String(row.from_branch_id) === String(currentBranchId) ||
        String(row.to_branch_id) === String(currentBranchId)
    );

    if (!rows.length) {
        historyBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b;">No transfers recorded for this branch yet.</td></tr>';
        return;
    }

    historyBody.innerHTML = rows.map((row) => `
        <tr>
            <td>${formatDateDisplay(row.created_at)}</td>
            <td>${getDisplayMaterialName(row.material_name)}</td>
            <td>${getBranchName(row.from_branch_id)}</td>
            <td>${getBranchName(row.to_branch_id)}</td>
            <td>${formatQuantity(row.qty)} ${row.unit || ''}</td>
            <td>${row.created_by || '--'}</td>
            <td>${row.notes || '--'}</td>
            <td style="text-align:right;">
                ${canDelete && isRecordInCurrentShiftWindow(row)
                    ? `<button class="btn" style="background:#e74c3c; color:white;" onclick="deleteStockTransferHistory('${row.id}')">Delete</button>`
                    : '--'}
            </td>
        </tr>
    `).join('');
}

function renderStockReceiptBatchInputs() {
    const body = document.getElementById('stockReceiptBatchBody');
    const totalNode = document.getElementById('stockReceiptBatchTotal');
    if (!body) return;

    if (!state.rawMaterials.length) {
        body.innerHTML = '<tr><td colspan="4" style="padding:18px; color:#64748b; text-align:center;">No stock items available yet.</td></tr>';
        if (totalNode) totalNode.innerText = 'Receipt Total: KES 0.00';
        return;
    }

    ensureStockReceiptDrafts();
    const selectedMaterialIds = state.stockReceiptDrafts
        .map((draft) => String(draft.materialId || ''))
        .filter(Boolean);

    body.innerHTML = state.stockReceiptDrafts.map((draft, index) => {
        const selectedMaterial = state.rawMaterials.find((item) => String(item.id) === String(draft.materialId));
        const selectedDisplayName = selectedMaterial ? getDisplayMaterialName(selectedMaterial.name) : '';
        const inputValue = draft.materialSearch || selectedDisplayName;
        const unitLabel = selectedMaterial?.buy_unit || selectedMaterial?.store_unit || '--';
        const conversionHint = selectedMaterial
            ? `Stores as ${Math.max(toNumber(selectedMaterial.conversion_factor), 1)} ${selectedMaterial.store_unit || selectedMaterial.buy_unit || ''}`
            : '';
        const effectiveTotalReceivedCost = draft.totalReceivedCost !== ''
            ? toNumber(draft.totalReceivedCost)
            : 0;
        const effectiveBuyUnitPrice = selectedMaterial && toNumber(draft.qty) > 0
            ? effectiveTotalReceivedCost / toNumber(draft.qty)
            : 0;
        const effectiveStoreUnitPrice = selectedMaterial
            ? effectiveBuyUnitPrice / Math.max(toNumber(selectedMaterial.conversion_factor), 1)
            : 0;
        const options = state.rawMaterials.map((material) => {
            const materialId = String(material.id);
            const isSelected = materialId === String(draft.materialId || '');
            const takenElsewhere = !isSelected && selectedMaterialIds.includes(materialId);
            const label = getDisplayMaterialName(material.name);
            return `<option value="${label}" data-material-id="${material.id}">${takenElsewhere ? `${label} (already selected)` : label}</option>`;
        }).join('');

        return `
            <tr>
                <td>
                    <input
                        type="text"
                        id="stockReceiptMaterial${index}"
                        name="stockReceiptMaterial${index}"
                        list="stockReceiptMaterialList${index}"
                        value="${inputValue}"
                        placeholder="Start typing item name"
                        autocomplete="off"
                        oninput="updateStockReceiptDraft(${index}, 'materialSearch', this.value)"
                        onchange="selectStockReceiptMaterial(${index}, this.value)">
                    <datalist id="stockReceiptMaterialList${index}">
                        ${options}
                    </datalist>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <div style="display:inline-block; min-width:72px; padding:6px 10px; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-weight:700; text-align:center;">
                            ${unitLabel}
                        </div>
                        <div style="font-size:11px; color:#64748b;">${conversionHint}</div>
                    </div>
                </td>
                <td>
                    <input type="number" id="stockReceiptQty${index}" name="stockReceiptQty${index}" min="0" step="0.01" value="${draft.qty || ''}" placeholder="0.00" oninput="updateStockReceiptDraft(${index}, 'qty', this.value)">
                </td>
                <td>
                    <input type="number" id="stockReceiptTotalCost${index}" name="stockReceiptTotalCost${index}" min="0" step="0.01" value="${draft.totalReceivedCost !== '' ? draft.totalReceivedCost : ''}" placeholder="0.00" oninput="updateStockReceiptDraft(${index}, 'totalReceivedCost', this.value)">
                </td>
                <td>
                    <div style="display:inline-block; min-width:96px; padding:6px 10px; border-radius:999px; background:#f0fdf4; color:#166534; font-weight:700; text-align:center;">
                        ${selectedMaterial ? formatMoney(effectiveStoreUnitPrice) : '--'}
                    </div>
                </td>
                <td style="text-align:right;">
                    <button class="btn" type="button" onclick="removeStockReceiptLine(${index})" ${state.stockReceiptDrafts.length === 1 ? 'disabled' : ''}>Remove</button>
                </td>
            </tr>
        `;
    }).join('');

    const batchTotal = state.stockReceiptDrafts.reduce((sum, draft) => (
        sum + toNumber(draft.totalReceivedCost)
    ), 0);
    if (totalNode) {
        totalNode.innerText = `Receipt Total: KES ${formatMoney(batchTotal)}`;
    }
}

function getFinanceInputs() {
    const carry = getCarryForwardBalances(state.currentShift);
    const totals = calculateFinanceLineTotals();
    return {
        mpesaOpening: toNumber(document.getElementById('mpesaOpening').value || state.financeDraft.mpesaOpening || carry.mpesaBf),
        mpesaClosing: toNumber(document.getElementById('mpesaClosing').value || state.financeDraft.mpesaClosing),
        mpesaWithdraw: toNumber(document.getElementById('mpesaWithdraw').value || state.financeDraft.mpesaWithdraw),
        cashAtHand: toNumber(document.getElementById('cashAtHand').value || state.financeDraft.cashAtHand),
        notes: String(document.getElementById('financeNotes')?.value || state.financeDraft.notes || '').trim(),
        totalExpenses: totals.totalExpenses,
        debtGiven: totals.totalDebtGiven,
        prevDebtsPaid: totals.totalDebtPaid,
        expenseLines: totals.expenseLines,
        debtGivenLines: totals.debtGivenLines,
        debtPaidLines: totals.debtPaidLines,
        totalSales: state.currentShiftTotal
    };
}

function collectClosingRows() {
    if (isDirectSalesMode()) {
        const visibleRows = Array.from(document.querySelectorAll('#salesBody .sales-input')).map((input) => {
            const item = state.items.find((entry) => String(entry.product_id) === String(input.dataset.productId));
            const rawValue = String(input.value ?? '').trim();
            const openingQty = toNumber(input.dataset.openingQty);
            const addedQty = toNumber(input.dataset.producedQty);
            const issuedQty = toNumber(input.dataset.issuedQty);
            const closingQty = rawValue === '' ? 0 : clampClosingQty(rawValue, toNumber(input.dataset.maxQty));
            return {
                shiftRowId: input.dataset.shiftRowId,
                productId: input.dataset.productId,
                name: item?.name || 'Item',
                hasClosingEntry: rawValue !== '',
                openingQty,
                producedQty: addedQty,
                receivedQty: 0,
                transferredOutQty: issuedQty,
                transferredInQty: 0,
                spoiltQty: 0,
                closingQty,
                saleMode: item?.sale_mode || 'full',
                soldQty: Math.max(0, openingQty + addedQty - issuedQty - closingQty),
                unitPrice: toNumber(item?.price),
                lineTotal: Math.max(0, openingQty + addedQty - issuedQty - closingQty) * toNumber(item?.price)
            };
        });

        const hiddenZeroRows = (state.items || [])
            .filter((item) => !shouldDisplaySalesItem(item))
            .map((item) => ({
                shiftRowId: item.id || '',
                productId: item.product_id,
                name: item?.name || 'Item',
                hasClosingEntry: true,
                openingQty: toNumber(item.bbf),
                producedQty: toNumber(item.added_today),
                receivedQty: 0,
                transferredOutQty: toNumber(item.issued_qty),
                transferredInQty: 0,
                spoiltQty: 0,
                closingQty: 0,
                saleMode: item?.sale_mode || 'full',
                soldQty: Math.max(0, toNumber(item.bbf) + toNumber(item.added_today) - toNumber(item.issued_qty)),
                unitPrice: toNumber(item?.price),
                lineTotal: Math.max(0, toNumber(item.bbf) + toNumber(item.added_today) - toNumber(item.issued_qty)) * toNumber(item?.price)
            }));

        return [...visibleRows, ...hiddenZeroRows];
    }

    const visibleRows = Array.from(document.querySelectorAll('#salesBody .sales-input')).map((input) => {
        const item = state.items.find((entry) => String(entry.product_id) === String(input.dataset.productId));
        const saleMode = item?.sale_mode || 'kitchen';
        const usesDirectMath = String(saleMode).toLowerCase() === 'direct';
        const soldQty = usesDirectMath
            ? Math.max(
                0,
                toNumber(input.dataset.openingQty) +
                toNumber(input.dataset.producedQty) -
                toNumber(input.dataset.issuedQty) -
                toNumber(input.value)
            )
            : calculateSoldQty({
                openingQty: input.dataset.openingQty,
                producedQty: input.dataset.producedQty,
                closingQty: input.value
            });
        return {
            shiftRowId: input.dataset.shiftRowId,
            productId: input.dataset.productId,
            name: item?.name || 'Item',
            hasClosingEntry: hasExplicitClosingDraft(input.dataset.productId),
            openingQty: toNumber(input.dataset.openingQty),
            producedQty: toNumber(input.dataset.producedQty),
            receivedQty: 0,
            transferredOutQty: 0,
            transferredInQty: 0,
            spoiltQty: toNumber(item?.spoilt),
            closingQty: toNumber(input.value),
            saleMode,
            soldQty,
            unitPrice: toNumber(item?.price),
            lineTotal: soldQty * toNumber(item?.price)
        };
    });

    const hiddenZeroRows = (state.items || [])
        .filter((item) => !shouldDisplaySalesItem(item))
        .map((item) => ({
            shiftRowId: item.id || '',
            productId: item.product_id,
            name: item?.name || 'Item',
            hasClosingEntry: true,
            openingQty: toNumber(item.bbf),
            producedQty: toNumber(item.added_today),
            receivedQty: 0,
            transferredOutQty: 0,
            transferredInQty: 0,
            spoiltQty: toNumber(item?.spoilt),
            closingQty: 0,
            saleMode: item?.sale_mode || 'kitchen',
            soldQty: 0,
            unitPrice: toNumber(item?.price),
            lineTotal: 0
        }));

    return [...visibleRows, ...hiddenZeroRows];
}

function validateFinanceLines() {
    const errors = [];
    getExpenseLines().forEach((line, index) => {
        if (!line.description) {
            errors.push(`Expense line ${index + 1}: description is required.`);
        }
        if (line.qty <= 0) {
            errors.push(`Expense line ${index + 1}: qty must be greater than 0.`);
        }
        if (line.unitCost < 0) {
            errors.push(`Expense line ${index + 1}: unit cost cannot be negative.`);
        }
    });

    ['given', 'paid'].forEach((type) => {
        const label = type === 'given' ? 'Debt given' : 'Debt paid';
        getDebtLines(type).forEach((line, index) => {
            if (!line.clientName) {
                errors.push(`${label} line ${index + 1}: client name is required.`);
            }
            if (!line.phone) {
                errors.push(`${label} line ${index + 1}: phone is required.`);
            }
            if (line.amount <= 0) {
                errors.push(`${label} line ${index + 1}: amount must be greater than 0.`);
            }
        });
    });

    return errors;
}

function resetFinanceFieldsForShift() {
    const carry = getCarryForwardBalances(state.currentShift);
    state.salesDrafts = {};
    state.financeDraft = {
        mpesaOpening: String(carry.mpesaBf || ''),
        mpesaClosing: '',
        mpesaWithdraw: '',
        cashAtHand: '',
        notes: '',
        expenseLines: [createExpenseDraft()],
        debtGivenLines: [createDebtDraft()],
        debtPaidLines: [createDebtDraft()]
    };
    document.getElementById('mpesaOpening').value = carry.mpesaBf;
    document.getElementById('mpesaClosing').value = '';
    document.getElementById('mpesaWithdraw').value = '';
    document.getElementById('cashAtHand').value = '';
    const financeNotesInput = document.getElementById('financeNotes');
    if (financeNotesInput) {
        financeNotesInput.value = '';
        autoResizeTextarea(financeNotesInput);
    }
    renderFinanceLineItems();
    window.calcRecon();
}

function primeNextShiftDraftState(carryOverride = null) {
    const carry = carryOverride || getCarryForwardBalances(state.currentShift);
    state.salesDrafts = {};
    state.financeDraft = {
        mpesaOpening: String(carry.mpesaBf || ''),
        mpesaClosing: '',
        mpesaWithdraw: '',
        cashAtHand: '',
        notes: '',
        expenseLines: [createExpenseDraft()],
        debtGivenLines: [createDebtDraft()],
        debtPaidLines: [createDebtDraft()]
    };
}

function applyNextShiftFinanceReset(carryOverride = null) {
    const carry = carryOverride || getCarryForwardBalances(state.currentShift);
    primeNextShiftDraftState(carry);

    const mpesaOpeningInput = document.getElementById('mpesaOpening');
    const mpesaClosingInput = document.getElementById('mpesaClosing');
    const mpesaWithdrawInput = document.getElementById('mpesaWithdraw');
    const cashAtHandInput = document.getElementById('cashAtHand');
    const financeNotesInput = document.getElementById('financeNotes');

    if (mpesaOpeningInput) mpesaOpeningInput.value = carry.mpesaBf || '';
    if (mpesaClosingInput) mpesaClosingInput.value = '';
    if (mpesaWithdrawInput) mpesaWithdrawInput.value = '';
    if (cashAtHandInput) cashAtHandInput.value = '';
    if (financeNotesInput) {
        financeNotesInput.value = '';
        autoResizeTextarea(financeNotesInput);
    }
}

function setReportDateRange(startDate, endDate = startDate) {
    const startDateInput = document.getElementById('reportStartDate');
    const endDateInput = document.getElementById('reportEndDate');
    if (startDateInput) startDateInput.value = startDate || '';
    if (endDateInput) endDateInput.value = endDate || startDate || '';
}

async function refreshCoreData() {
    await loadCurrentShift();
    await loadBarStockIssues();
    await loadInventory();
    await loadBranches();
    await loadRawMaterials();
    await loadSupplyItems();
    await loadRecipes();
    await loadStockReceipts();
    await loadSupplyReceipts();
    await loadStockTransfers();
    updateDropdowns();
    await loadKitchenData();
}

async function initApp() {
    await refreshCoreData();
    updateSidebarUserSummary();
    updatePageBranchLabels();
    startIdleLogoutMonitor();
    await window.showPage(getDefaultPage());
}

window.handleLogin = async () => {
    try {
        const loginIdentifier = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPass').value;
        if (!loginIdentifier) throw new Error('Enter your username or email.');
        let data;
        let error;

        if (loginIdentifier.includes('@')) {
            ({ data, error } = await repositories.signIn(loginIdentifier, password));
        } else {
            const candidates = buildAuthEmailCandidates(loginIdentifier);
            for (const candidate of candidates) {
                ({ data, error } = await repositories.signIn(candidate, password));
                if (!error) break;
            }
        }

        if (error) throw error;

        const { data: profile, error: profileError } = await repositories.getProfile(data.user.id);
        if (profileError) throw profileError;
        if (!profile?.restaurant_id) throw new Error('User profile or restaurant_id missing');
        if (!(profile?.branch_id || profile?.default_branch_id)) throw new Error('User profile or branch_id missing');
        if (profile?.is_active === false) {
            await repositories.signOut();
            throw new Error('This account is inactive. Please contact your system administrator.');
        }

        setSessionContext(profile);
        if (!state.role) {
            await repositories.signOut();
            throw new Error('This account has an invalid or missing role. Please contact your system administrator.');
        }
        applyRoleAccess();
        updatePageBranchLabels();
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('sidebar').classList.remove('hidden');
        await initApp();
    } catch (error) {
        handleError(error, 'Login failed');
    }
};

window.handleLogout = async (skipAlert = false) => {
    stopIdleLogoutMonitor();
    idleLogoutInProgress = true;
    closeAppModalImmediate();
    await repositories.signOut();
    resetAppState();
    location.reload();
};

window.renderSales = renderSales;
window.renderFinishedProducts = renderFinishedProducts;
window.loadInventory = async () => {
    try {
        await loadInventory();
    } catch (error) {
        handleError(error, 'Failed to load inventory');
    }
};
window.loadRawMaterials = async () => {
    try {
        await loadRawMaterials();
        updateDropdowns();
    } catch (error) {
        handleError(error, 'Failed to load raw materials');
    }
};
window.loadSupplyItems = async () => {
    try {
        await loadSupplyItems();
        renderSupplyReceiptsView();
    } catch (error) {
        handleError(error, 'Failed to load supply items');
    }
};
window.loadSupplyReceipts = async () => {
    try {
        await loadSupplyReceipts();
    } catch (error) {
        handleError(error, 'Failed to load supply receipts');
    }
};
window.loadBranches = async () => {
    try {
        await loadBranches();
        renderBarIssueView();
        renderStockTransferView();
    } catch (error) {
        handleError(error, 'Failed to load branches');
    }
};
window.renderStoreStockLevels = renderStoreStockLevels;
window.switchBranchContext = async (branchId) => {
    try {
        if (!canSwitchBranches(state.role)) {
            throw new Error('You do not have permission to switch branches.');
        }

        const nextBranchId = String(branchId || '').trim();
        if (!nextBranchId || String(nextBranchId) === String(state.branchId || '')) {
            updateBranchSwitcher();
            return;
        }

        const targetBranch = (state.branches || []).find((branch) => String(branch.id) === nextBranchId);
        if (!targetBranch) {
            throw new Error('Selected branch was not found.');
        }

        if (String(targetBranch.restaurant_id) !== String(state.restaurantId)) {
            throw new Error('You can only switch within your current restaurant.');
        }

        state.branchId = nextBranchId;
        state.useBranchScope = true;
        resetBranchScopedDrafts();
        updateBranchSwitcher();
        updatePageBranchLabels();

        const activePage = document.querySelector('.page.active')?.id || getDefaultPage();
        await refreshCoreData();
        const nextPage = canAccessPage(activePage) ? activePage : getDefaultPage();
        await window.showPage(nextPage);
    } catch (error) {
        updateBranchSwitcher();
        handleError(error, 'Failed to switch branch');
    }
};
window.loadRecipes = async () => {
    try {
        await loadRecipes();
    } catch (error) {
        handleError(error, 'Failed to load recipes');
    }
};
window.loadStockReceipts = async () => {
    try {
        await loadStockReceipts();
    } catch (error) {
        handleError(error, 'Failed to load stock receipts');
    }
};
window.loadStockTransfers = async () => {
    try {
        await loadStockTransfers();
    } catch (error) {
        handleError(error, 'Failed to load stock transfers');
    }
};
window.loadCurrentShift = async () => {
    try {
        await loadCurrentShift();
    } catch (error) {
        handleError(error, 'Failed to load current shift');
    }
};

window.calcSalesRow = (element) => {
    const item = state.items.find((entry) => String(entry.product_id) === String(element.dataset.productId));
    const maxQty = toNumber(element.dataset.maxQty);
    const rawValue = String(element.value ?? '').trim();
    if (rawValue === '') {
        if (item) item.closing_stock = null;
        delete state.salesDrafts[String(element.dataset.productId)];
        recalculateSalesTotals();
        return;
    }

    const safeValue = clampClosingQty(rawValue, maxQty);
    element.value = safeValue;
    if (item && !usesDirectStockMath(item)) item.closing_stock = safeValue;
    state.salesDrafts[String(element.dataset.productId)] = safeValue;
    recalculateSalesTotals();
};

window.dismissAppModal = () => {
    if (typeof appModalState.dismissHandler === 'function') {
        appModalState.dismissHandler();
        return;
    }

    closeAppModalImmediate();
};

window.filterSales = () => {
    const searchTerm = document.getElementById('salesSearch').value.toLowerCase();
    const rows = Array.from(document.querySelectorAll('#salesBody tr'));
    const sectionVisibility = new Map();

    rows.forEach((row) => {
        if (row.classList.contains('sales-section-row')) return;
        const itemName = row.cells[0]?.innerText.toLowerCase() || '';
        const visible = itemName.includes(searchTerm);
        row.style.display = visible ? '' : 'none';

        const previousSectionRow = row.previousElementSibling?.classList.contains('sales-section-row')
            ? row.previousElementSibling
            : null;
        const sectionKey = previousSectionRow?.dataset.section
            || Array.from(row.parentElement.children)
                .slice(0, Array.from(row.parentElement.children).indexOf(row))
                .reverse()
                .find((entry) => entry.classList?.contains('sales-section-row'))
                ?.dataset.section
            || '';
        if (sectionKey) {
            sectionVisibility.set(sectionKey, (sectionVisibility.get(sectionKey) || false) || visible);
        }
    });

    document.querySelectorAll('#salesBody .sales-section-row').forEach((row) => {
        row.style.display = sectionVisibility.get(row.dataset.section) ? '' : 'none';
    });
};

window.addExpenseLine = () => {
    ensureFinanceDrafts();
    state.financeDraft.expenseLines = [...state.financeDraft.expenseLines, createExpenseDraft()];
    renderExpenseRows();
};

window.removeExpenseLine = (index) => {
    ensureFinanceDrafts();
    state.financeDraft.expenseLines = state.financeDraft.expenseLines.filter((_, rowIndex) => rowIndex !== index);
    if (!state.financeDraft.expenseLines.length) {
        state.financeDraft.expenseLines = [createExpenseDraft()];
    }
    renderExpenseRows();
    window.calcRecon();
};

window.updateExpenseLine = (index, field, value) => {
    ensureFinanceDrafts();
    state.financeDraft.expenseLines = state.financeDraft.expenseLines.map((line, rowIndex) => (
        rowIndex === index ? { ...line, [field]: value } : line
    ));
    window.calcRecon();
};

window.addDebtLine = (type) => {
    ensureFinanceDrafts();
    const key = type === 'paid' ? 'debtPaidLines' : 'debtGivenLines';
    state.financeDraft[key] = [...state.financeDraft[key], createDebtDraft()];
    renderDebtRows(type);
};

window.removeDebtLine = (type, index) => {
    ensureFinanceDrafts();
    const key = type === 'paid' ? 'debtPaidLines' : 'debtGivenLines';
    state.financeDraft[key] = state.financeDraft[key].filter((_, rowIndex) => rowIndex !== index);
    if (!state.financeDraft[key].length) {
        state.financeDraft[key] = [createDebtDraft()];
    }
    renderDebtRows(type);
    window.calcRecon();
};

window.updateDebtLine = (type, index, field, value) => {
    ensureFinanceDrafts();
    const key = type === 'paid' ? 'debtPaidLines' : 'debtGivenLines';
    state.financeDraft[key] = state.financeDraft[key].map((line, rowIndex) => (
        rowIndex === index ? { ...line, [field]: value } : line
    ));
    window.calcRecon();
};

window.addStockReceiptLine = () => {
    ensureStockReceiptDrafts();
    state.stockReceiptDrafts = [createStockReceiptDraft(), ...state.stockReceiptDrafts];
    renderStockReceiptBatchInputs();
};

window.removeStockReceiptLine = (index) => {
    ensureStockReceiptDrafts();
    state.stockReceiptDrafts = state.stockReceiptDrafts.filter((_, rowIndex) => rowIndex !== index);
    if (!state.stockReceiptDrafts.length) {
        state.stockReceiptDrafts = [createStockReceiptDraft()];
    }
    renderStockReceiptBatchInputs();
};

window.updateStockReceiptDraft = (index, field, value) => {
    ensureStockReceiptDrafts();
    state.stockReceiptDrafts = state.stockReceiptDrafts.map((draft, rowIndex) => (
        rowIndex === index ? { ...draft, [field]: value } : draft
    ));
    if (field === 'materialId') {
        renderStockReceiptBatchInputs();
    }
};

window.selectStockReceiptMaterial = (index, value) => {
    ensureStockReceiptDrafts();
    const material = findRawMaterialByDisplayName(value);

    if (!material) {
        state.stockReceiptDrafts = state.stockReceiptDrafts.map((draft, rowIndex) => (
            rowIndex === index
                ? { ...draft, materialId: '', materialSearch: value }
                : draft
        ));
        renderStockReceiptBatchInputs();
        return;
    }

    const duplicateIndex = state.stockReceiptDrafts.findIndex((draft, rowIndex) =>
        rowIndex !== index && String(draft.materialId || '') === String(material.id)
    );

    if (duplicateIndex !== -1) {
        handleError(new Error('This drink is already selected in another receipt line.'), 'Duplicate item');
        state.stockReceiptDrafts = state.stockReceiptDrafts.map((draft, rowIndex) => (
            rowIndex === index
                ? { ...draft, materialId: '', materialSearch: '' }
                : draft
        ));
        renderStockReceiptBatchInputs();
        return;
    }

    state.stockReceiptDrafts = state.stockReceiptDrafts.map((draft, rowIndex) => (
        rowIndex === index
            ? {
                ...draft,
                materialId: material.id,
                materialSearch: getDisplayMaterialName(material.name)
            }
            : draft
    ));
    renderStockReceiptBatchInputs();
};

window.addSupplyReceiptLine = () => {
    ensureSupplyReceiptDrafts();
    state.supplyReceiptDrafts = [createSupplyReceiptDraft(), ...state.supplyReceiptDrafts];
    renderSupplyReceiptsView();
};

window.removeSupplyReceiptLine = (index) => {
    ensureSupplyReceiptDrafts();
    state.supplyReceiptDrafts = state.supplyReceiptDrafts.filter((_, rowIndex) => rowIndex !== index);
    if (!state.supplyReceiptDrafts.length) {
        state.supplyReceiptDrafts = [createSupplyReceiptDraft()];
    }
    renderSupplyReceiptsView();
};

window.updateSupplyReceiptDraft = (index, field, value) => {
    ensureSupplyReceiptDrafts();
    state.supplyReceiptDrafts = state.supplyReceiptDrafts.map((draft, rowIndex) => (
        rowIndex === index ? { ...draft, [field]: value } : draft
    ));
};

window.selectSupplyReceiptItem = (index, value) => {
    ensureSupplyReceiptDrafts();
    const supplyItem = findSupplyItemByDisplayName(value);

    if (!supplyItem) {
        state.supplyReceiptDrafts = state.supplyReceiptDrafts.map((draft, rowIndex) => (
            rowIndex === index
                ? { ...draft, supplyItemId: '', itemSearch: value }
                : draft
        ));
        renderSupplyReceiptsView();
        return;
    }

    const duplicateIndex = state.supplyReceiptDrafts.findIndex((draft, rowIndex) =>
        rowIndex !== index && String(draft.supplyItemId || '') === String(supplyItem.id)
    );

    if (duplicateIndex !== -1) {
        handleError(new Error('This supply item is already selected in another line.'), 'Duplicate item');
        state.supplyReceiptDrafts = state.supplyReceiptDrafts.map((draft, rowIndex) => (
            rowIndex === index
                ? { ...draft, supplyItemId: '', itemSearch: value }
                : draft
        ));
        renderSupplyReceiptsView();
        return;
    }

    state.supplyReceiptDrafts = state.supplyReceiptDrafts.map((draft, rowIndex) => (
        rowIndex === index
            ? {
                ...draft,
                supplyItemId: supplyItem.id,
                itemSearch: getDisplaySupplyItemName(supplyItem.name),
                category: supplyItem.category || draft.category || 'General Supplies',
                buyUnit: supplyItem.buy_unit || draft.buyUnit || ''
            }
            : draft
    ));
    renderSupplyReceiptsView();
};

window.updateStockTransferDraft = (field, value) => {
    if (field === 'toBranchId') {
        state.stockTransferDestinationBranchId = value;
    }
    renderStockTransferView();
};

window.addStockTransferLine = () => {
    ensureStockTransferDrafts();
    state.stockTransferDrafts = [...state.stockTransferDrafts, createStockTransferDraft()];
    renderStockTransferView();
};

window.removeStockTransferLine = (index) => {
    ensureStockTransferDrafts();
    state.stockTransferDrafts = state.stockTransferDrafts.filter((_, rowIndex) => rowIndex !== index);
    if (!state.stockTransferDrafts.length) {
        state.stockTransferDrafts = [createStockTransferDraft()];
    }
    renderStockTransferView();
};

window.updateStockTransferDraftRow = (index, field, value) => {
    ensureStockTransferDrafts();
    state.stockTransferDrafts = state.stockTransferDrafts.map((draft, rowIndex) => (
        rowIndex === index ? { ...draft, [field]: value } : draft
    ));
    if (field === 'materialId') {
        renderStockTransferView();
    }
};

window.selectStockTransferMaterial = (index, value) => {
    ensureStockTransferDrafts();
    const material = findRawMaterialByDisplayName(value);

    if (!material) {
        state.stockTransferDrafts = state.stockTransferDrafts.map((draft, rowIndex) => (
            rowIndex === index ? { ...draft, materialId: '', materialSearch: value } : draft
        ));
        renderStockTransferView();
        return;
    }

    const duplicateIndex = state.stockTransferDrafts.findIndex((draft, rowIndex) =>
        rowIndex !== index && String(draft.materialId || '') === String(material.id)
    );

    if (duplicateIndex !== -1) {
        handleError(new Error('This drink is already selected in another transfer line.'), 'Duplicate item');
        state.stockTransferDrafts = state.stockTransferDrafts.map((draft, rowIndex) => (
            rowIndex === index ? { ...draft, materialId: '', materialSearch: '' } : draft
        ));
        renderStockTransferView();
        return;
    }

    state.stockTransferDrafts = state.stockTransferDrafts.map((draft, rowIndex) => (
        rowIndex === index
            ? { ...draft, materialId: material.id, materialSearch: getDisplayMaterialName(material.name) }
            : draft
    ));
    renderStockTransferView();
};

window.addBarIssueLine = () => {
    ensureBarIssueDrafts();
    state.barIssueDrafts = [...state.barIssueDrafts, createBarIssueDraft()];
    renderBarIssueView();
};

window.removeBarIssueLine = (index) => {
    ensureBarIssueDrafts();
    state.barIssueDrafts = state.barIssueDrafts.filter((_, rowIndex) => rowIndex !== index);
    if (!state.barIssueDrafts.length) {
        state.barIssueDrafts = [createBarIssueDraft()];
    }
    renderBarIssueView();
};

window.updateBarIssueDraftRow = (index, field, value) => {
    ensureBarIssueDrafts();
    state.barIssueDrafts = state.barIssueDrafts.map((draft, rowIndex) => (
        rowIndex === index ? { ...draft, [field]: value } : draft
    ));
};

window.selectBarIssueSource = (index, value) => {
    ensureBarIssueDrafts();
    const source = findRawMaterialByDisplayName(value)
        || getBarIssueSourceMaterials().find((material) => entityNamesMatch(material.name, value));
    state.barIssueDrafts = state.barIssueDrafts.map((draft, rowIndex) => (
        rowIndex === index
            ? {
                ...draft,
                sourceMaterialId: source?.id || '',
                sourceMaterialSearch: source ? getDisplayMaterialName(source.name) : value
            }
            : draft
    ));
    renderBarIssueView();
};

window.selectBarIssueTarget = (index, value) => {
    ensureBarIssueDrafts();
    const target = findProductByDisplayName(value)
        || getBarIssueTargetProducts().find((item) => entityNamesMatch(item.name, value));
    state.barIssueDrafts = state.barIssueDrafts.map((draft, rowIndex) => (
        rowIndex === index
            ? {
                ...draft,
                targetProductId: target?.product_id || '',
                targetProductSearch: target ? getDisplayProductName(target.name) : value
            }
            : draft
    ));
    renderBarIssueView();
};

window.calcRecon = () => {
    const carry = getCarryForwardBalances(state.currentShift);
    const mpesaOpeningInput = document.getElementById('mpesaOpening');
    if (mpesaOpeningInput && mpesaOpeningInput.value === '') {
        mpesaOpeningInput.value = carry.mpesaBf;
    }

    const finance = getFinanceInputs();
    syncFinanceDraftFromDom();
    const mpesaIncome = calculateMpesaIncome(finance.mpesaOpening, finance.mpesaClosing, finance.mpesaWithdraw);
    const accountedIncome = calculateAccountedIncome({
        cashAtHand: finance.cashAtHand,
        mpesaIncome,
        totalExpenses: finance.totalExpenses,
        debtGiven: finance.debtGiven,
        prevDebtsPaid: finance.prevDebtsPaid
    });
    const variance = calculateVariance(finance.totalSales, accountedIncome);

    document.getElementById('netMpesa').innerText = formatMoney(mpesaIncome);
    document.getElementById('incomeFromSales').innerText = formatMoney(accountedIncome);
    document.getElementById('totalSalesVal').innerText = formatMoney(finance.totalSales);
    const totalExpensesEl = document.getElementById('totalExpenses');
    const debtGivenEl = document.getElementById('debtGiven');
    const debtPaidEl = document.getElementById('prevDebtsPaid');
    if (totalExpensesEl) totalExpensesEl.value = formatMoney(finance.totalExpenses);
    if (debtGivenEl) debtGivenEl.value = formatMoney(finance.debtGiven);
    if (debtPaidEl) debtPaidEl.value = formatMoney(finance.prevDebtsPaid);

    const varianceEl = document.getElementById('varianceVal');
    varianceEl.innerText = formatMoney(variance);
    varianceEl.style.color = variance < -0.009 ? '#b91c1c' : variance > 0.009 ? '#166534' : '#166534';
    varianceEl.style.fontWeight = '700';
};

window.handleFinanceNotesInput = (textarea) => {
    autoResizeTextarea(textarea);
    ensureFinanceDrafts();
    state.financeDraft.notes = textarea?.value || '';
};

window.updateKeyStoreCheckDraft = (materialId, value) => {
    state.keyStoreCheckDrafts[String(materialId)] = value;
    const row = buildKeyStoreCheckRows().find((entry) => String(entry.materialId) === String(materialId));
    const varianceNode = document.getElementById(`keyStoreVar_${materialId}`);
    if (varianceNode) {
        varianceNode.innerText = row?.varianceQty === null ? '--' : formatQuantity(row.varianceQty, 4);
        varianceNode.style.color = row?.varianceQty === null ? '#64748b' : '';
        varianceNode.style.fontWeight = '700';
        if (row?.varianceQty !== null) {
            varianceNode.style.cssText = `padding:7px 10px; font-size:12px; font-weight:700; ${getVarianceDisplayStyle(row.varianceQty)}`;
        } else {
            varianceNode.style.cssText = 'padding:7px 10px; font-size:12px; font-weight:700; color:#64748b;';
        }
    }
};

window.editSellingProduct = (id) => {
    requirePermission(PERMISSIONS.MANAGE_PRODUCTS);
    const item = state.items.find((entry) => String(entry.product_id) === String(id));
    if (!item) return;
    document.getElementById('productId').value = item.product_id;
    document.getElementById('pName').value = item.name || '';
    document.getElementById('pPrice').value = item.price || '';
    refreshFinishedProductCategoryOptions(item.category || getDefaultRecipeCategory());
    document.getElementById('prodFormTitle').innerText = 'Edit Selling Item';
    document.getElementById('cancelProdBtn').style.display = 'inline-block';
    document.getElementById('saveProdBtn').innerText = 'Update Product';
    openHostedModal('Edit Selling Item', 'finishedProductsFormCard', () => window.resetProductForm());
};

window.resetProductForm = () => {
    document.getElementById('productId').value = '';
    document.getElementById('pName').value = '';
    document.getElementById('pPrice').value = '';
    refreshFinishedProductCategoryOptions(getDefaultRecipeCategory());
    document.getElementById('prodFormTitle').innerText = 'Add New Selling Item';
    document.getElementById('cancelProdBtn').style.display = 'none';
    document.getElementById('saveProdBtn').innerText = 'Save Product';
    if (appModalState.sourceId === 'finishedProductsFormCard') {
        closeAppModalImmediate();
    }
};

window.resetRecipeForm = () => {
    const productSelect = document.getElementById('masterProductSelect');
    const categorySelect = document.getElementById('productCategory');
    const recipeYieldInput = document.getElementById('recipeYield');

    if (productSelect) productSelect.value = '';
    if (categorySelect) refreshRecipeCategoryOptions(getDefaultRecipeCategory());
    if (recipeYieldInput) recipeYieldInput.value = '1';

    for (let i = 1; i <= 3; i += 1) {
        const ingredientSelect = document.getElementById(`ing${i}`);
        const quantityInput = document.getElementById(`qty${i}`);
        if (ingredientSelect) ingredientSelect.value = '';
        if (quantityInput) quantityInput.value = '';
        updateIngredientUnitHint(i);
    }

    if (appModalState.sourceId === 'managerOnlyMatrix') {
        closeAppModalImmediate();
    }
};

window.saveSellingProduct = async () => {
    const button = document.getElementById('saveProdBtn');
    setLoading(button, true);
    try {
        requirePermission(PERMISSIONS.MANAGE_PRODUCTS);
        const id = document.getElementById('productId').value;
        const name = document.getElementById('pName').value.trim();
        const price = toNumber(document.getElementById('pPrice').value);
        const category = document.getElementById('pCat').value;
        if (!name || price <= 0) throw new Error('Please enter a valid name and price.');

        const { error } = await repositories.saveProduct(getScope(), { name, price, category }, id);
        if (error) throw error;

        showAppToast('Product saved successfully!');
        window.resetProductForm();
        await loadInventory();
        updateDropdowns();
    } catch (error) {
        handleError(error, 'Failed to save product');
    } finally {
        setLoading(button, false);
    }
};

window.deleteSellingProduct = async (id) => {
    if (!confirm('Are you sure you want to deactivate this product? It will be removed from daily use but kept in history.')) return;
    try {
        requirePermission(PERMISSIONS.MANAGE_PRODUCTS);
        const scope = getScope();
        const { error } = await repositories.deactivateProduct(scope, id);
        if (error) throw error;
        showAppToast('Product deactivated successfully.');
        await loadInventory();
        updateDropdowns();
    } catch (error) {
        handleError(error, 'Failed to deactivate product');
    }
};

window.saveMasterRecipe = async () => {
    const button = document.getElementById('saveMasterBtn');
    setLoading(button, true);
    try {
        requirePermission(PERMISSIONS.MANAGE_RECIPES);
        const productName = document.getElementById('masterProductSelect').value;
        const recipeYield = Math.max(toNumber(document.getElementById('recipeYield').value), 1);
        if (!productName) throw new Error('Select a product');

        const batch = [];
        for (let i = 1; i <= 3; i += 1) {
            const materialName = document.getElementById(`ing${i}`).value;
            const quantityInput = document.getElementById(`qty${i}`);
            const rawQuantity = quantityInput?.value || '';
            if (hasMoreThanTwoDecimals(rawQuantity)) {
                throw new Error(`Ingredient ${i} quantity can have at most 2 decimal places.`);
            }
            const quantity = toNumber(rawQuantity);
            const hasMaterial = Boolean(String(materialName || '').trim());
            const hasQuantity = String(rawQuantity).trim() !== '' && quantity > 0;

            if (hasMaterial && !hasQuantity) {
                throw new Error(`Ingredient ${i} is selected but quantity is missing or zero.`);
            }
            if (!hasMaterial && String(rawQuantity).trim() !== '') {
                throw new Error(`Ingredient ${i} quantity is entered but no ingredient is selected.`);
            }

            if (materialName && quantity > 0) {
                batch.push({
                    restaurant_id: state.restaurantId,
                    finished_item_name: productName,
                    material_name: materialName,
                    qty_per_unit: quantity / recipeYield
                });
            }
        }
        if (!batch.length) throw new Error('Add at least one ingredient');

        const { error } = await repositories.upsertRecipes(getScope(), batch);
        if (error) throw error;
        showAppToast('Recipe updated successfully');
        await loadRecipes();
        window.resetRecipeForm();
    } catch (error) {
        handleError(error, 'Failed to save recipe');
    } finally {
        setLoading(button, false);
    }
};

window.loadExistingRecipe = (productName) => {
    const selectedProduct = state.items.find((item) => String(item.name || '') === String(productName || ''));
    refreshRecipeCategoryOptions(selectedProduct?.category || getDefaultRecipeCategory());

    for (let i = 1; i <= 3; i += 1) {
        document.getElementById(`ing${i}`).value = '';
        document.getElementById(`qty${i}`).value = '';
        updateIngredientUnitHint(i);
    }
    if (!productName) return;
    state.recipeMatrix
        .filter((recipe) => recipe.finished_item_name === productName)
        .slice(0, 3)
        .forEach((recipe, index) => {
            document.getElementById(`ing${index + 1}`).value = recipe.material_name || '';
            document.getElementById(`qty${index + 1}`).value = toNumber(recipe.qty_per_unit);
            updateIngredientUnitHint(index + 1);
        });
};

window.editRecipe = (productName) => {
    requirePermission(PERMISSIONS.MANAGE_RECIPES);
    const productInput = document.getElementById('masterProductSelect');
    if (!productInput) return;

    productInput.value = productName || '';
    window.loadExistingRecipe(productName);
    openHostedModal('Edit Recipe', 'managerOnlyMatrix', () => window.resetRecipeForm());
    productInput.focus();
};

window.updateIngredientUnitHint = updateIngredientUnitHint;

window.selectKitchenDraftProduct = (index, value) => {
    ensureKitchenDrafts();
    const product = findProductByDisplayName(value);

    if (!product) {
        state.kitchenDrafts = state.kitchenDrafts.map((draft, rowIndex) => (
            rowIndex === index ? { ...draft, productId: '', productSearch: value } : draft
        ));
        renderKitchenBatchInputs();
        return;
    }

    if (String(product.sale_mode || '').toLowerCase() === 'direct') {
        handleError(new Error('This item is sold directly from store and should not be added in Kitchen Ops.'), 'Direct sale item');
        state.kitchenDrafts = state.kitchenDrafts.map((draft, rowIndex) => (
            rowIndex === index ? { ...draft, productId: '', productSearch: '' } : draft
        ));
        renderKitchenBatchInputs();
        return;
    }

    const duplicateIndex = state.kitchenDrafts.findIndex((draft, rowIndex) =>
        rowIndex !== index && String(draft.productId || '') === String(product.product_id)
    );

    if (duplicateIndex !== -1) {
        handleError(new Error('This product is already selected in another kitchen row.'), 'Duplicate item');
        state.kitchenDrafts = state.kitchenDrafts.map((draft, rowIndex) => (
            rowIndex === index ? { ...draft, productId: '', productSearch: '' } : draft
        ));
        renderKitchenBatchInputs();
        return;
    }

    state.kitchenDrafts = state.kitchenDrafts.map((draft, rowIndex) => (
        rowIndex === index
            ? { ...draft, productId: product.product_id, productSearch: getDisplayProductName(product.name) }
            : draft
    ));
    renderKitchenBatchInputs();
};

window.deleteRecipe = async (id) => {
    if (!confirm('Delete this recipe line?')) return;
    try {
        requirePermission(PERMISSIONS.MANAGE_RECIPES);
        const { error } = await repositories.deleteRecipeRow(getScope(), id);
        if (error) throw error;
        await loadRecipes();
    } catch (error) {
        handleError(error, 'Failed to delete recipe');
    }
};

window.processReverseDispatch = async () => {
    const button = document.getElementById('postBtn');
    setLoading(button, true, 'Posting...');
    try {
        requirePermission(PERMISSIONS.POST_KITCHEN_OUTPUT);
        if (!state.currentShift?.id) throw new Error('No active shift');
        const entries = (state.kitchenDrafts || [])
            .map((entry, index) => ({
                index,
                productId: entry.productId,
                qty: toNumber(entry.qty)
            }))
            .filter((entry) => entry.productId && entry.qty > 0);

        if (!entries.length) throw new Error('Enter quantity for at least one finished product');

        const successIndexes = new Set();
        const failures = [];

        for (const entry of entries) {
            try {
                await recordReverseDispatch(getScope(), repositories, state.currentShift.id, entry.productId, entry.qty);
                successIndexes.add(entry.index);
            } catch (error) {
                const item = state.items.find((product) => String(product.product_id) === String(entry.productId));
                const itemName = getDisplayProductName(item?.name || 'Item');
                failures.push(`- ${itemName}: ${error.message}`);
            }
        }

        state.kitchenDrafts = state.kitchenDrafts.filter((_, rowIndex) => !successIndexes.has(rowIndex));
        if (!state.kitchenDrafts.length) {
            state.kitchenDrafts = [createKitchenDraftRow()];
        }
        renderKitchenBatchInputs();
        await loadInventory();
        await loadKitchenData();

        if (successIndexes.size > 0) {
            showAppToast(
                failures.length
                    ? `Posted ${successIndexes.size} item${successIndexes.size === 1 ? '' : 's'}. Unposted items remain for correction.`
                    : 'Production posted successfully'
            );
        }

        if (failures.length) {
            throw new Error(`Some production items were not posted:\n${failures.join('\n')}`);
        }
    } catch (error) {
        handleError(error, 'Failed to post production');
    } finally {
        setLoading(button, false);
    }
};

window.adjustKitchenProduction = async (productId) => {
    try {
        requirePermission(PERMISSIONS.POST_KITCHEN_OUTPUT);
        if (!state.currentShift?.id) {
            throw new Error('No active shift was found.');
        }

        const item = state.items.find((entry) => String(entry.product_id) === String(productId));
        if (!item?.id) {
            throw new Error('Selected production row was not found.');
        }

        const currentAddedQty = toNumber(item.added_today);
        const response = await openPromptModal({
            title: 'Adjust Kitchen Production',
            label: `Enter the corrected total added quantity for ${getDisplayProductName(item.name)}.`,
            initialValue: String(currentAddedQty),
            inputType: 'number',
            inputStep: '0.01',
            confirmText: 'Save Adjustment'
        });

        if (response === null) {
            return;
        }

        const trimmedValue = String(response).trim();
        if (!trimmedValue) {
            throw new Error('Adjustment quantity is required.');
        }

        const nextAddedQty = Number(trimmedValue);
        if (!Number.isFinite(nextAddedQty)) {
            throw new Error('Enter a valid quantity.');
        }
        if (nextAddedQty < 0) {
            throw new Error('Quantity cannot be negative.');
        }

        if (!confirm(`Adjust ${getDisplayProductName(item.name)} from ${formatQuantity(currentAddedQty)} to ${formatQuantity(nextAddedQty)}? Raw material stock will be rebalanced automatically.`)) {
            return;
        }

        await adjustReverseDispatch(getScope(), repositories, state.currentShift.id, productId, nextAddedQty);
        await loadInventory();
        await loadKitchenData();
        showAppToast(`Production adjusted for ${getDisplayProductName(item.name)}.`);
    } catch (error) {
        handleError(error, 'Failed to adjust kitchen production');
    }
};

window.processStockReceipt = async () => {
    const button = document.querySelector('#stocksPage .btn.btn-success');
    setLoading(button, true);
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        ensureStockReceiptDrafts();
        const populatedRows = state.stockReceiptDrafts
            .map((draft, index) => ({
                index,
                materialId: String(draft.materialId || ''),
                qty: toNumber(draft.qty),
                totalReceivedCost: toNumber(draft.totalReceivedCost)
            }))
            .filter((row) => row.materialId || row.qty > 0 || row.totalReceivedCost > 0);

        if (!populatedRows.length) throw new Error('Add at least one receipt line before posting.');

        populatedRows.forEach((row) => {
            if (!row.materialId) {
                throw new Error(`Receipt line ${row.index + 1}: select a material.`);
            }
            if (row.qty <= 0) {
                throw new Error(`Receipt line ${row.index + 1}: quantity must be greater than 0.`);
            }
            if (row.totalReceivedCost <= 0) {
                throw new Error(`Receipt line ${row.index + 1}: total received cost must be greater than 0.`);
            }
        });

        const appliedRows = [];

        try {
            for (const row of populatedRows) {
            const material = state.rawMaterials.find((entry) => String(entry.id) === row.materialId);
            if (!material) throw new Error(`Receipt line ${row.index + 1}: selected material was not found.`);
            const conversionFactor = Math.max(toNumber(material.conversion_factor), 1);
            const postedStoreQty = row.qty * conversionFactor;
            const buyUnitPrice = row.totalReceivedCost / row.qty;
            const storeUnitPrice = buyUnitPrice / conversionFactor;
            const totalReceivedCost = row.totalReceivedCost;

              const { data: receiptRow, error: receiptError } = await repositories.insertStockReceipt(getScope(), {
                  shiftId: state.currentShift?.id || null,
                  materialName: material.name,
                  qtyReceived: row.qty,
                  receivedBy: getProfileDisplayName(state.user),
                  buyUnit: material.buy_unit || '',
                  storeUnit: material.store_unit || material.buy_unit || '',
                conversionFactor,
                qtyPostedStore: postedStoreQty,
                buyUnitPrice,
                storeUnitPrice,
                totalReceivedCost
            });
            if (receiptError) throw receiptError;

            const { error: stockError } = await repositories.adjustRawMaterialStoreStock(getScope(), material.name, postedStoreQty);
            if (stockError) throw stockError;

            const { error: materialPriceError } = await repositories.updateRawMaterialPrice(getScope(), material.id, buyUnitPrice);
            if (materialPriceError) throw materialPriceError;

                appliedRows.push({
                    receiptId: receiptRow?.id || null,
                    materialId: material.id,
                    materialName: material.name,
                    postedStoreQty,
                    previousPrice: toNumber(material.price)
                });
            }
        } catch (error) {
            for (const applied of appliedRows.reverse()) {
                try {
                    await repositories.adjustRawMaterialStoreStock(getScope(), applied.materialName, -applied.postedStoreQty);
                } catch {
                    // Best-effort rollback; keep original error as the primary failure.
                }

                try {
                    await repositories.updateRawMaterialPrice(getScope(), applied.materialId, applied.previousPrice);
                } catch {
                    // Best-effort rollback; keep original error as the primary failure.
                }

                if (applied.receiptId) {
                    try {
                        await repositories.deleteStockReceipt(getScope(), applied.receiptId);
                    } catch {
                        // Best-effort rollback; keep original error as the primary failure.
                    }
                }
            }

            throw error;
        }

        state.stockReceiptDrafts = [createStockReceiptDraft()];
        renderStockReceiptBatchInputs();
        showAppToast(`Recorded ${populatedRows.length} stock receipt${populatedRows.length === 1 ? '' : 's'} successfully.`);
        await loadStockReceipts();
        await loadInventory();
        updateDropdowns();
    } catch (error) {
        handleError(error, 'Failed to record stock');
    } finally {
        setLoading(button, false);
    }
};

window.processSupplyReceipt = async () => {
    const button = document.getElementById('processSupplyReceiptBtn');
    setLoading(button, true);
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        ensureSupplyReceiptDrafts();

        const populatedRows = state.supplyReceiptDrafts
            .map((draft, index) => ({
                index,
                supplyItemId: String(draft.supplyItemId || ''),
                itemSearch: String(draft.itemSearch || '').trim(),
                category: String(draft.category || '').trim(),
                buyUnit: String(draft.buyUnit || '').trim(),
                qty: toNumber(draft.qty),
                totalReceivedCost: toNumber(draft.totalReceivedCost),
                notes: String(draft.notes || '').trim()
            }))
            .filter((row) => row.supplyItemId || row.itemSearch || row.qty > 0 || row.totalReceivedCost > 0 || row.notes);

        if (!populatedRows.length) throw new Error('Add at least one supply receipt line before posting.');

        const createdItemIds = [];
        const localSupplyItems = [...(state.supplyItems || [])];
        const seenNames = new Set();

        for (const row of populatedRows) {
            if (!row.itemSearch) {
                throw new Error(`Supply line ${row.index + 1}: enter an item name.`);
            }
            if (!row.buyUnit) {
                throw new Error(`Supply line ${row.index + 1}: buying unit is required.`);
            }
            if (row.qty <= 0) {
                throw new Error(`Supply line ${row.index + 1}: quantity must be greater than 0.`);
            }
            if (row.totalReceivedCost <= 0) {
                throw new Error(`Supply line ${row.index + 1}: total received cost must be greater than 0.`);
            }

            let supplyItem = row.supplyItemId
                ? localSupplyItems.find((item) => String(item.id) === row.supplyItemId)
                : findSupplyItemByDisplayName(row.itemSearch);

            if (!supplyItem) {
                const created = await repositories.createSupplyItem(getScope(), {
                    name: row.itemSearch,
                    category: row.category || 'General Supplies',
                    buyUnit: row.buyUnit
                });
                if (created.error) throw created.error;
                supplyItem = created.data;
                createdItemIds.push(supplyItem.id);
                localSupplyItems.push(supplyItem);
            }

            const normalizedName = normalizeEntityName(supplyItem.name);
            if (seenNames.has(normalizedName)) {
                throw new Error(`Supply line ${row.index + 1}: this item is already entered in another line.`);
            }
            seenNames.add(normalizedName);

            row.supplyItemId = supplyItem.id;
            row.itemName = supplyItem.name;
            row.category = row.category || supplyItem.category || 'General Supplies';
            row.buyUnit = row.buyUnit || supplyItem.buy_unit || '';
        }

        const insertedReceiptIds = [];
        try {
            for (const row of populatedRows) {
                const unitCost = row.totalReceivedCost / row.qty;
                const receiptResult = await repositories.insertSupplyReceipt(getScope(), {
                    shiftId: state.currentShift?.id || null,
                    supplyItemId: row.supplyItemId,
                    itemName: row.itemName,
                    category: row.category || 'General Supplies',
                    qtyReceived: row.qty,
                    buyUnit: row.buyUnit,
                    totalReceivedCost: row.totalReceivedCost,
                    unitCost,
                    notes: row.notes,
                    receivedBy: getProfileDisplayName(state.user)
                });
                if (receiptResult.error) throw receiptResult.error;
                if (receiptResult.data?.id) {
                    insertedReceiptIds.push(receiptResult.data.id);
                }
            }
        } catch (error) {
            for (const receiptId of insertedReceiptIds.reverse()) {
                await supabase.from('supply_receipts').delete().eq('id', receiptId);
            }
            throw error;
        }

        state.supplyReceiptDrafts = [createSupplyReceiptDraft()];
        await loadSupplyItems();
        await loadSupplyReceipts();
        renderSupplyReceiptsView();
        showAppToast(`Recorded ${populatedRows.length} supply receipt${populatedRows.length === 1 ? '' : 's'} successfully.`);
    } catch (error) {
        handleError(error, 'Failed to record supplies');
    } finally {
        setLoading(button, false);
    }
};

window.processStockTransfer = async () => {
    const button = document.getElementById('processStockTransferBtn');
    setLoading(button, true);
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        ensureStockTransferDrafts();
        const sourceBranchId = state.branchId || state.user?.branch_id || state.user?.default_branch_id || '';

        const destinationSelect = document.getElementById('stockTransferToBranch');
        const destinationBranches = getTransferDestinationBranches();

        const toBranchId = String(
            destinationSelect?.value ||
            state.stockTransferDestinationBranchId ||
            (destinationBranches.length === 1 ? destinationBranches[0].id : '')
        ).trim();

        if (!sourceBranchId) {
            throw new Error('Your user profile is missing a source branch.');
        }

        if (!toBranchId) {
            throw new Error('Select a destination branch for the transfer.');
        }

        const populatedRows = state.stockTransferDrafts
            .map((draft, index) => ({
                index,
                materialId: String(draft.materialId || ''),
                qty: toNumber(draft.qty),
                notes: String(draft.notes || '').trim()
            }))
            .filter((row) => row.materialId || row.qty > 0 || row.notes);

        if (!populatedRows.length) {
            throw new Error('Add at least one transfer line before posting.');
        }

        populatedRows.forEach((row) => {
            if (!row.materialId) {
                throw new Error(`Transfer line ${row.index + 1}: select a material.`);
            }
            if (row.qty <= 0) {
                throw new Error(`Transfer line ${row.index + 1}: quantity must be greater than 0.`);
            }
        });

        const appliedTransfers = [];

        try {
            for (const row of populatedRows) {
                const material = state.rawMaterials.find((entry) => String(entry.id) === row.materialId);
                if (!material) {
                    throw new Error(`Transfer line ${row.index + 1}: selected material was not found in the current branch stock.`);
                }

                const result = await transferRawMaterial(getScope(), repositories, {
                    fromBranchId: sourceBranchId,
                    toBranchId,
                    materialName: material.name,
                    qty: row.qty,
                    notes: row.notes,
                    createdBy: state.username || 'Staff'
                });

                if (result?.error) throw result.error;

                appliedTransfers.push({
                    transferId: result?.data?.transfer?.id || null,
                    materialName: material.name,
                    qty: row.qty
                });
            }
        } catch (error) {
            for (const applied of appliedTransfers.reverse()) {
                try {
                    await repositories.adjustRawMaterialStoreStockByBranch(getScope(), toBranchId, applied.materialName, -applied.qty);
                    await repositories.adjustRawMaterialStoreStockByBranch(getScope(), sourceBranchId, applied.materialName, applied.qty);
                } catch {
                    // Best-effort rollback; original error remains primary.
                }

                if (applied.transferId) {
                    try {
                        await repositories.deleteStockTransfer(getScope(), applied.transferId);
                    } catch {
                        // Best-effort rollback; original error remains primary.
                    }
                }
            }

            throw error;
        }

        state.stockTransferDrafts = [createStockTransferDraft()];
        await loadRawMaterials();
        await loadStockTransfers();
        updateDropdowns();
        renderStoreStockLevels();
        showAppToast(`Recorded ${populatedRows.length} stock transfer${populatedRows.length === 1 ? '' : 's'} successfully.`);
    } catch (error) {
        handleError(error, 'Failed to transfer stock');
    } finally {
        setLoading(button, false);
    }
};

window.processBarIssue = async () => {
    const button = document.querySelector('#stocksIssuesView .btn.btn-success');
    setLoading(button, true);
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        if (!isDirectSalesMode()) {
            throw new Error('Bar stock issues are only available in direct sales mode.');
        }
        if (!state.currentShift?.id) {
            throw new Error('No active shift found for this branch.');
        }

        ensureBarIssueDrafts();
        const populatedRows = state.barIssueDrafts
            .map((draft, index) => ({
                index,
                sourceMaterialId: String(draft.sourceMaterialId || ''),
                sourceMaterialSearch: String(draft.sourceMaterialSearch || '').trim(),
                targetProductId: String(draft.targetProductId || ''),
                targetProductSearch: String(draft.targetProductSearch || '').trim(),
                qty: toNumber(draft.qty),
                notes: String(draft.notes || '').trim()
            }))
            .filter((row) => row.sourceMaterialId || row.targetProductId || row.qty > 0 || row.notes);

        if (!populatedRows.length) {
            throw new Error('Add at least one issue line before posting.');
        }

        const appliedRows = [];
        try {
            for (const row of populatedRows) {
                const resolvedSourceMaterial = row.sourceMaterialId
                    ? state.rawMaterials.find((material) => String(material.id) === row.sourceMaterialId)
                    : (findRawMaterialByDisplayName(row.sourceMaterialSearch)
                        || getBarIssueSourceMaterials().find((material) => entityNamesMatch(material.name, row.sourceMaterialSearch)));
                const resolvedTargetProduct = row.targetProductId
                    ? state.items.find((item) => String(item.product_id) === row.targetProductId)
                    : (findProductByDisplayName(row.targetProductSearch)
                        || getBarIssueTargetProducts().find((item) => entityNamesMatch(item.name, row.targetProductSearch)));

                if (!row.sourceMaterialId && resolvedSourceMaterial?.id) {
                    row.sourceMaterialId = String(resolvedSourceMaterial.id);
                }
                if (!row.targetProductId && resolvedTargetProduct?.product_id) {
                    row.targetProductId = String(resolvedTargetProduct.product_id);
                }

                if (!row.sourceMaterialId) {
                    throw new Error(`Issue line ${row.index + 1}: select a source stock item.`);
                }
                if (!row.targetProductId) {
                    throw new Error(`Issue line ${row.index + 1}: select a shots/glasses item.`);
                }
                if (row.qty <= 0) {
                    throw new Error(`Issue line ${row.index + 1}: quantity must be greater than 0.`);
                }

                const sourceMaterial = resolvedSourceMaterial || state.rawMaterials.find((material) => String(material.id) === row.sourceMaterialId);
                const targetProduct = resolvedTargetProduct || state.items.find((item) => String(item.product_id) === row.targetProductId);
                if (!sourceMaterial) {
                    throw new Error(`Issue line ${row.index + 1}: source stock item was not found.`);
                }
                if (!targetProduct) {
                    throw new Error(`Issue line ${row.index + 1}: target measured item was not found.`);
                }

                const conversion = getBarIssueConversion(sourceMaterial.name, targetProduct.name);
                if (!conversion) {
                    throw new Error(`Issue line ${row.index + 1}: no conversion matrix was found between ${getDisplayMaterialName(sourceMaterial.name)} and ${getDisplayProductName(targetProduct.name)}.`);
                }

                const availableUnits = getSellableUnitsForMaterial(sourceMaterial);
                if (row.qty > availableUnits) {
                    throw new Error(`Issue line ${row.index + 1}: available stock is ${formatQuantity(availableUnits)} ${sourceMaterial.buy_unit || 'units'}.`);
                }

                const sourceStoreDeductionQty = row.qty * Math.max(toNumber(sourceMaterial.conversion_factor), 1);
                const targetAddedQty = row.qty * conversion.addedUnitsPerIssueUnit;
                const { data: existingRow, error: existingRowError } = await repositories.getShiftInventoryRow(getScope(), state.currentShift.id, targetProduct.product_id);
                if (existingRowError) throw existingRowError;

                const stockResult = await repositories.adjustRawMaterialStoreStock(getScope(), sourceMaterial.name, -sourceStoreDeductionQty);
                if (stockResult.error) throw stockResult.error;

                const upsertPayload = {
                    shift_id: state.currentShift.id,
                    product_id: targetProduct.product_id,
                    bbf: toNumber(existingRow?.bbf),
                    added_today: toNumber(existingRow?.added_today) + targetAddedQty,
                    close_qty: toNumber(existingRow?.close_qty),
                    sold_qty: toNumber(existingRow?.sold_qty)
                };
                if (existingRow?.id) {
                    upsertPayload.id = existingRow.id;
                }

                const { error: upsertError } = await repositories.upsertShiftInventoryRows(getScope(), [upsertPayload]);
                if (upsertError) {
                    await repositories.adjustRawMaterialStoreStock(getScope(), sourceMaterial.name, sourceStoreDeductionQty);
                    throw upsertError;
                }

                const issueResult = await repositories.insertBarStockIssue(getScope(), {
                    shiftId: state.currentShift.id,
                    sourceMaterialName: sourceMaterial.name,
                    targetProductName: targetProduct.name,
                    qtyIssuedSource: row.qty,
                    sourceBuyUnit: sourceMaterial.buy_unit || 'unit',
                    qtyAddedTarget: targetAddedQty,
                    targetUnit: 'units',
                    conversionFactor: conversion.addedUnitsPerIssueUnit,
                    notes: row.notes,
                    createdBy: state.username || 'Staff'
                });
                if (issueResult.error) {
                    await repositories.adjustRawMaterialStoreStock(getScope(), sourceMaterial.name, sourceStoreDeductionQty);
                    await repositories.upsertShiftInventoryRows(getScope(), [{
                        id: existingRow?.id || upsertPayload.id,
                        shift_id: state.currentShift.id,
                        product_id: targetProduct.product_id,
                        bbf: toNumber(existingRow?.bbf),
                        added_today: toNumber(existingRow?.added_today),
                        close_qty: toNumber(existingRow?.close_qty),
                        sold_qty: toNumber(existingRow?.sold_qty)
                    }]);
                    throw issueResult.error;
                }

                appliedRows.push({
                    sourceMaterialName: sourceMaterial.name,
                    sourceStoreDeductionQty,
                    targetProductId: targetProduct.product_id,
                    previousShiftRow: existingRow,
                    issueId: issueResult.data?.id || null
                });
            }
        } catch (error) {
            for (const applied of appliedRows.reverse()) {
                try {
                    await repositories.adjustRawMaterialStoreStock(getScope(), applied.sourceMaterialName, applied.sourceStoreDeductionQty);
                } catch {}
                try {
                    await repositories.upsertShiftInventoryRows(getScope(), [{
                        id: applied.previousShiftRow?.id || crypto.randomUUID(),
                        shift_id: state.currentShift.id,
                        product_id: applied.targetProductId,
                        bbf: toNumber(applied.previousShiftRow?.bbf),
                        added_today: toNumber(applied.previousShiftRow?.added_today),
                        close_qty: toNumber(applied.previousShiftRow?.close_qty),
                        sold_qty: toNumber(applied.previousShiftRow?.sold_qty)
                    }]);
                } catch {}
                if (applied.issueId) {
                    try {
                        await repositories.deleteBarStockIssue(getScope(), applied.issueId);
                    } catch {}
                }
            }
            throw error;
        }

        state.barIssueDrafts = [createBarIssueDraft()];
        await loadBarStockIssues();
        await loadRawMaterials();
        await loadInventory();
        updateDropdowns();
        showAppToast(`Recorded ${populatedRows.length} bar issue${populatedRows.length === 1 ? '' : 's'} successfully.`);
    } catch (error) {
        handleError(error, 'Failed to record issue to shots');
    } finally {
        setLoading(button, false);
    }
};

window.deleteStockReceiptHistory = async (receiptId) => {
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        if (!canDeleteStockHistory()) {
            throw new Error('Only managers can delete stock history entries.');
        }

        const receipt = (state.stockReceipts || []).find((row) => String(row.id) === String(receiptId));
        if (!receipt) {
            throw new Error('Selected stock receipt was not found in the current shift view.');
        }
        if (!isRecordInCurrentShiftWindow(receipt)) {
            throw new Error('Only current-shift stock receipts can be deleted.');
        }
        if (!confirm(`Delete receipt for ${getDisplayMaterialName(receipt.material_name)} and reverse its stock addition?`)) {
            return;
        }

        const reverseQty = toNumber(
            receipt.qty_posted_store ??
            (toNumber(receipt.qty_received) * Math.max(toNumber(receipt.conversion_factor), 1))
        );

        const stockResult = await repositories.adjustRawMaterialStoreStock(getScope(), receipt.material_name, -reverseQty);
        if (stockResult.error) throw stockResult.error;

        const deleteResult = await repositories.deleteStockReceipt(getScope(), receipt.id);
        if (deleteResult.error) {
            await repositories.adjustRawMaterialStoreStock(getScope(), receipt.material_name, reverseQty);
            throw deleteResult.error;
        }

        await loadStockReceipts();
        await loadRawMaterials();
        if (document.getElementById('storeStockLevelsBody')) {
            renderStoreStockLevels();
        }
        updateDropdowns();
        showAppToast('Stock receipt deleted and stock reversed.');
    } catch (error) {
        handleError(error, 'Failed to delete stock receipt');
    }
};

window.deleteStockTransferHistory = async (transferId) => {
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        if (!canDeleteStockHistory()) {
            throw new Error('Only managers can delete stock history entries.');
        }

        const transfer = (state.stockTransfers || []).find((row) => String(row.id) === String(transferId));
        if (!transfer) {
            throw new Error('Selected stock transfer was not found.');
        }
        if (!isRecordInCurrentShiftWindow(transfer)) {
            throw new Error('Only current-shift transfers can be deleted.');
        }
        if (!confirm(`Delete transfer of ${getDisplayMaterialName(transfer.material_name)} and reverse the stock movement?`)) {
            return;
        }

        const qty = toNumber(transfer.qty);
        const toBranchReverse = await repositories.adjustRawMaterialStoreStockByBranch(getScope(), transfer.to_branch_id, transfer.material_name, -qty);
        if (toBranchReverse.error) throw toBranchReverse.error;

        const fromBranchRestore = await repositories.adjustRawMaterialStoreStockByBranch(getScope(), transfer.from_branch_id, transfer.material_name, qty);
        if (fromBranchRestore.error) {
            await repositories.adjustRawMaterialStoreStockByBranch(getScope(), transfer.to_branch_id, transfer.material_name, qty);
            throw fromBranchRestore.error;
        }

        const deleteResult = await repositories.deleteStockTransfer(getScope(), transfer.id);
        if (deleteResult.error) {
            await repositories.adjustRawMaterialStoreStockByBranch(getScope(), transfer.from_branch_id, transfer.material_name, -qty);
            await repositories.adjustRawMaterialStoreStockByBranch(getScope(), transfer.to_branch_id, transfer.material_name, qty);
            throw deleteResult.error;
        }

        await loadRawMaterials();
        await loadStockTransfers();
        if (document.getElementById('storeStockLevelsBody')) {
            renderStoreStockLevels();
        }
        updateDropdowns();
        showAppToast('Stock transfer deleted and stock reversed.');
    } catch (error) {
        handleError(error, 'Failed to delete stock transfer');
    }
};

window.deleteBarIssueHistory = async (issueId) => {
    try {
        requirePermission(PERMISSIONS.RECEIVE_STOCK);
        if (!canDeleteStockHistory()) {
            throw new Error('Only managers can delete stock history entries.');
        }

        const issue = (state.barStockIssues || []).find((row) => String(row.id) === String(issueId));
        if (!issue) {
            throw new Error('Selected issue record was not found.');
        }
        if (!isRecordInCurrentShiftWindow(issue)) {
            throw new Error('Only current-shift issue records can be deleted.');
        }
        if (!confirm(`Delete issue from ${getDisplayMaterialName(issue.source_material_name)} to ${getDisplayProductName(issue.target_product_name)} and reverse its stock impact?`)) {
            return;
        }

        const sourceMaterial = (state.rawMaterials || []).find((material) => entityNamesMatch(material.name, issue.source_material_name));
        if (!sourceMaterial) {
            throw new Error(`Source stock item "${getDisplayMaterialName(issue.source_material_name)}" was not found.`);
        }

        const targetProduct = (state.items || []).find((item) => entityNamesMatch(item.name, issue.target_product_name));
        if (!targetProduct) {
            throw new Error(`Target product "${getDisplayProductName(issue.target_product_name)}" was not found.`);
        }

        const { data: existingRow, error: existingRowError } = await repositories.getShiftInventoryRow(getScope(), issue.shift_id || state.currentShift?.id, targetProduct.product_id);
        if (existingRowError) throw existingRowError;

        const currentAddedQty = toNumber(existingRow?.added_today);
        const nextAddedQty = currentAddedQty - toNumber(issue.qty_added_target);
        if (nextAddedQty < 0) {
            throw new Error(`Cannot delete this issue because ${getDisplayProductName(issue.target_product_name)} only has ${formatQuantity(currentAddedQty)} added units recorded.`);
        }

        const sourceRestoreQty = toNumber(issue.qty_issued_source) * Math.max(toNumber(sourceMaterial.conversion_factor), 1);
        const restoreResult = await repositories.adjustRawMaterialStoreStock(getScope(), sourceMaterial.name, sourceRestoreQty);
        if (restoreResult.error) throw restoreResult.error;

        const upsertPayload = {
            shift_id: issue.shift_id || state.currentShift?.id,
            product_id: targetProduct.product_id,
            bbf: toNumber(existingRow?.bbf),
            added_today: nextAddedQty,
            close_qty: toNumber(existingRow?.close_qty),
            sold_qty: toNumber(existingRow?.sold_qty)
        };
        if (existingRow?.id) {
            upsertPayload.id = existingRow.id;
        }

        const { error: upsertError } = await repositories.upsertShiftInventoryRows(getScope(), [upsertPayload]);
        if (upsertError) {
            await repositories.adjustRawMaterialStoreStock(getScope(), sourceMaterial.name, -sourceRestoreQty);
            throw upsertError;
        }

        const deleteResult = await repositories.deleteBarStockIssue(getScope(), issue.id);
        if (deleteResult.error) {
            await repositories.adjustRawMaterialStoreStock(getScope(), sourceMaterial.name, -sourceRestoreQty);
            await repositories.upsertShiftInventoryRows(getScope(), [{
                id: existingRow?.id || upsertPayload.id,
                shift_id: issue.shift_id || state.currentShift?.id,
                product_id: targetProduct.product_id,
                bbf: toNumber(existingRow?.bbf),
                added_today: currentAddedQty,
                close_qty: toNumber(existingRow?.close_qty),
                sold_qty: toNumber(existingRow?.sold_qty)
            }]);
            throw deleteResult.error;
        }

        await loadBarStockIssues();
        await loadRawMaterials();
        await loadInventory();
        updateDropdowns();
        showAppToast('Issue record deleted and stock reversed.');
    } catch (error) {
        handleError(error, 'Failed to delete stock issue');
    }
};

window.adjustStoreStockLevel = async (materialId) => {
    try {
        requirePermission(PERMISSIONS.MANAGE_RAW_MATERIALS);
        if (!canAdjustStockLevels()) {
            throw new Error('Only managers can adjust stock levels.');
        }

        const material = (state.rawMaterials || []).find((entry) => String(entry.id) === String(materialId));
        if (!material) {
            throw new Error('Selected stock item was not found.');
        }

        const currentStock = toNumber(material.stock_level ?? material.current_stock);
        const unitLabel = material.store_unit || 'units';
        const response = await openPromptModal({
            title: 'Adjust Store Stock',
            label: `Enter the corrected stock level for ${getDisplayMaterialName(material.name)} in ${unitLabel}.`,
            initialValue: String(currentStock),
            inputType: 'number',
            inputStep: '0.01',
            confirmText: 'Save Adjustment'
        });

        if (response === null) {
            return;
        }

        const trimmedValue = String(response).trim();
        if (!trimmedValue) {
            throw new Error('Stock level adjustment requires a value.');
        }

        const nextStockLevel = Number(trimmedValue);
        if (!Number.isFinite(nextStockLevel)) {
            throw new Error('Enter a valid stock quantity.');
        }
        if (nextStockLevel < 0) {
            throw new Error('Stock level cannot be negative.');
        }

        if (!confirm(`Set ${getDisplayMaterialName(material.name)} stock to ${formatQuantity(nextStockLevel)} ${unitLabel}?`)) {
            return;
        }

        const result = await repositories.updateRawMaterialStockLevel(getScope(), material.id, nextStockLevel);
        if (result.error) throw result.error;

        await loadRawMaterials();
        renderStoreStockLevels();
        updateDropdowns();
        showAppToast(`Stock level updated for ${getDisplayMaterialName(material.name)}.`);
    } catch (error) {
        handleError(error, 'Failed to adjust stock level');
    }
};

window.finalizeShift = async () => {
    const button = document.querySelector('#financePage .btn.btn-success');
    if (!confirm('Confirm Shift Closure? Individual expenses and debts will be logged for audit.')) return;
    setLoading(button, true, 'Finalizing Shift...');
    try {
        requirePermission(PERMISSIONS.CLOSE_SHIFT);
        const financeLineErrors = validateFinanceLines();
        if (financeLineErrors.length) {
            throw new Error(financeLineErrors.join('\n'));
        }
        const finance = { ...getFinanceInputs() };
        const result = await closeShiftWithCarryForward(getScope(), repositories, state.currentShift, {
            inventoryRows: collectClosingRows(),
            keyStoreChecks: collectKeyStoreChecks(),
            finance,
            expenseLines: finance.expenseLines,
            debtGivenLines: finance.debtGivenLines,
            debtPaidLines: finance.debtPaidLines,
            closedBy: state.user?.full_name || state.user?.email || 'Staff'
        });
        const closedShiftDate = toDateOnly(result.closedShift?.created_at || new Date());

        state.currentShift = {
            ...result.nextShift,
            mpesa_float: finance.mpesaClosing,
            mpesa_closing: 0,
            mpesa_withdrawals: 0,
            mpesa_income: 0,
            cash_at_hand: finance.cashAtHand
        };
        state.currentShiftTotal = 0;
        applyNextShiftFinanceReset({
            mpesaBf: finance.mpesaClosing,
            cashBf: finance.cashAtHand
        });
        setReportDateRange(closedShiftDate, closedShiftDate);
        await window.showPage('reportsPage');
        await window.loadShiftReport();
        showAppToast(`Shift closed successfully. Recorded sales: KES ${formatMoney(finance.totalSales)}.`);
    } catch (error) {
        handleError(error, 'Shift close failed');
    } finally {
        setLoading(button, false);
    }
};

window.showPage = async (id) => {
    if (!canAccessPage(id)) {
        handleError(new Error('You do not have access to that page.'), 'Access denied');
        return;
    }

    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    updateSidebarNavState(id);

      try {
          if (id === 'finishedProductsPage' || id === 'salesPage') {
              if (isDirectSalesMode()) {
                  await loadBarStockIssues();
              }
              await loadInventory();
              await refreshCurrentShiftSummary();
        } else if (id === 'kitchenPage') {
            await loadCurrentShift();
            await loadInventory();
            updateDropdowns();
            await loadKitchenData();
        } else if (id === 'matrixPage') {
            await loadInventory();
            await loadRawMaterials();
            updateDropdowns();
        } else if (id === 'stocksPage') {
            await loadBranches();
            await loadRawMaterials();
            await loadSupplyItems();
            await loadSupplyReceipts();
            await loadBarStockIssues();
            await loadStockTransfers();
            updateDropdowns();
            setStocksView('receipts');
            renderStoreStockLevels();
        } else if (id === 'storePage') {
            await loadRawMaterials();
        } else if (id === 'reportsPage') {
            const startDateInput = document.getElementById('reportStartDate');
            const endDateInput = document.getElementById('reportEndDate');
            if (startDateInput && !startDateInput.value) startDateInput.value = toDateOnly();
            if (endDateInput && !endDateInput.value) endDateInput.value = toDateOnly();
            window.switchReportView('shift-reports');
            await window.loadShiftReport();
        } else if (id === 'staffPage') {
            await window.loadStaffProfiles();
        } else if (id === 'accountPage') {
            populateAccountPage();
        } else if (id === 'manualPage') {
            renderOperationManual(document.getElementById('manualSearch')?.value || '');
        } else if (id === 'financePage') {
              await loadInventory();
              await loadStockReceipts();
              await loadStockTransfers();
              await ensureCurrentShiftKeyStoreChecks();
              ensureFinanceDrafts();
              const carry = getCarryForwardBalances(state.currentShift);
              document.getElementById('mpesaOpening').value = state.financeDraft.mpesaOpening !== ''
                  ? state.financeDraft.mpesaOpening
                : carry.mpesaBf;
            document.getElementById('mpesaClosing').value = state.financeDraft.mpesaClosing ?? '';
            document.getElementById('mpesaWithdraw').value = state.financeDraft.mpesaWithdraw ?? '';
              document.getElementById('cashAtHand').value = state.financeDraft.cashAtHand ?? '';
              const financeNotesInput = document.getElementById('financeNotes');
              if (financeNotesInput) {
                  financeNotesInput.value = state.financeDraft.notes ?? '';
                  autoResizeTextarea(financeNotesInput);
              }
              renderFinanceLineItems();
              renderKeyStoreChecks();
              window.calcRecon();
          }
          if (isSupervisorReadOnlyMasterPage(id)) {
              applyMasterPageModes();
          }
          updatePageBranchLabels();
      } catch (error) {
          handleError(error, `Failed to load ${id}`);
      }
  };

window.updateDropdowns = updateDropdowns;
window.filterOperationManual = () => {
    const query = document.getElementById('manualSearch')?.value || '';
    renderOperationManual(query);
};
window.toggleInventoryNavGroup = () => {
    if (INVENTORY_PAGE_IDS.includes(getActivePageId())) {
        setInventoryNavExpanded(true);
        return;
    }
    setInventoryNavExpanded(!inventoryNavExpanded);
};
window.switchStocksView = async (view) => {
    if (view === 'transfers') {
        try {
            await prepareStockTransferView();
        } catch (error) {
            handleError(error, 'Failed to load transfer view');
            return;
        }
    }

    setStocksView(view);
};

window.saveRawMaterial = async () => {
    const button = document.getElementById('saveRawBtn');
    setLoading(button, true, 'Saving...');
    try {
        requirePermission(PERMISSIONS.MANAGE_RAW_MATERIALS);
        const id = document.getElementById('rawMaterialId').value;
        const code = document.getElementById('rawCode').value.trim().toUpperCase();
        const rawName = document.getElementById('rawName').value.trim();
        const name = composeMaterialName(code, rawName);
        const buyUnit = document.getElementById('buyUnit').value.trim();
        const storeUnit = document.getElementById('storeUnit').value.trim();
        const conversionFactor = Math.max(toNumber(document.getElementById('convFactor').value), 1);
        const price = toNumber(document.getElementById('buyPrice').value);
        const reorderLevel = Math.max(toNumber(document.getElementById('reorderLevel').value), 0);
        const isKeyShiftItem = document.getElementById('rawIsKeyShiftItem').checked;
        if (!rawName || price <= 0) throw new Error('Please enter a Material Name and Price.');

        const { error } = await repositories.saveRawMaterial(
            getScope(),
            { name, buyUnit, storeUnit, conversionFactor, price, reorderLevel, isKeyShiftItem },
            id
        );
        if (error) throw error;

        showAppToast(id ? 'Material Updated!' : 'Material Added!');
        window.resetRawForm();
        await loadRawMaterials();
        updateDropdowns();
    } catch (error) {
        handleError(error, 'Save Failed');
    } finally {
        setLoading(button, false);
    }
};

window.previewRawMaterialImport = async () => {
    const button = document.getElementById('previewRawImportBtn');
    setLoading(button, true, 'Parsing...');
    try {
        requirePermission(PERMISSIONS.IMPORT_RAW_MATERIALS);
        rawImportRows = await readRawImportRows();
        renderRawImportPreview(rawImportRows);
        setRawImportStatus(`Preview ready: ${rawImportRows.length} row(s) parsed successfully.`);
    } catch (error) {
        rawImportRows = [];
        renderRawImportPreview([]);
        setRawImportStatus(error.message || 'Failed to parse CSV.', true);
    } finally {
        setLoading(button, false);
    }
};

window.importRawMaterialCsv = async () => {
    const button = document.getElementById('importRawBtn');
    setLoading(button, true, 'Importing...');
    try {
        requirePermission(PERMISSIONS.IMPORT_RAW_MATERIALS);
        if (!rawImportRows.length) {
            rawImportRows = await readRawImportRows();
            renderRawImportPreview(rawImportRows);
        }

        const { error } = await repositories.importRawMaterials(getScope(), rawImportRows, state.rawMaterials);
        if (error) throw error;

        setRawImportStatus(`Imported ${rawImportRows.length} row(s). Existing material names were updated; new ones were inserted.`);
        document.getElementById('rawImportFile').value = '';
        rawImportRows = [];
        renderRawImportPreview([]);
        await loadRawMaterials();
        updateDropdowns();
    } catch (error) {
        setRawImportStatus(error.message || 'Import failed.', true);
        handleError(error, 'Failed to import raw materials');
    } finally {
        setLoading(button, false);
    }
};

window.previewProductImport = async () => {
    const button = document.getElementById('previewProductImportBtn');
    setLoading(button, true, 'Parsing...');
    try {
        requirePermission(PERMISSIONS.MANAGE_PRODUCTS);
        productImportRows = await readProductImportRows();
        renderProductImportPreview(productImportRows);
        setProductImportStatus(`Preview ready: ${productImportRows.length} row(s) parsed successfully.`);
    } catch (error) {
        productImportRows = [];
        renderProductImportPreview([]);
        setProductImportStatus(error.message || 'Failed to parse CSV.', true);
    } finally {
        setLoading(button, false);
    }
};

window.importProductCsv = async () => {
    const button = document.getElementById('importProductBtn');
    setLoading(button, true, 'Importing...');
    try {
        requirePermission(PERMISSIONS.MANAGE_PRODUCTS);
        if (!productImportRows.length) {
            productImportRows = await readProductImportRows();
            renderProductImportPreview(productImportRows);
        }

        const { error } = await repositories.importProducts(getScope(), productImportRows, state.items);
        if (error) throw error;

        setProductImportStatus(`Imported ${productImportRows.length} row(s). Existing product names were updated; new ones were inserted.`);
        document.getElementById('productImportFile').value = '';
        productImportRows = [];
        renderProductImportPreview([]);
        await loadInventory();
        updateDropdowns();
    } catch (error) {
        setProductImportStatus(error.message || 'Import failed.', true);
        handleError(error, 'Finished product import failed');
    } finally {
        setLoading(button, false);
    }
};

window.previewRecipeImport = async () => {
    const button = document.getElementById('previewRecipeImportBtn');
    setLoading(button, true, 'Parsing...');
    try {
        requirePermission(PERMISSIONS.MANAGE_RECIPES);
        recipeImportRows = await readRecipeImportRows();
        renderRecipeImportPreview(recipeImportRows);
        setRecipeImportStatus(`Preview ready: ${recipeImportRows.length} row(s) parsed successfully.`);
    } catch (error) {
        recipeImportRows = [];
        renderRecipeImportPreview([]);
        setRecipeImportStatus(error.message || 'Failed to parse CSV.', true);
    } finally {
        setLoading(button, false);
    }
};

window.importRecipeCsv = async () => {
    const button = document.getElementById('importRecipeBtn');
    setLoading(button, true, 'Importing...');
    try {
        requirePermission(PERMISSIONS.MANAGE_RECIPES);
        if (!recipeImportRows.length) {
            recipeImportRows = await readRecipeImportRows();
            renderRecipeImportPreview(recipeImportRows);
        }

        const { error } = await repositories.importRecipes(getScope(), recipeImportRows);
        if (error) throw error;

        setRecipeImportStatus(`Imported ${recipeImportRows.length} row(s). Matching recipe rows were upserted.`);
        document.getElementById('recipeImportFile').value = '';
        recipeImportRows = [];
        renderRecipeImportPreview([]);
        await loadRecipes();
        updateDropdowns();
    } catch (error) {
        setRecipeImportStatus(error.message || 'Import failed.', true);
        handleError(error, 'Recipe matrix import failed');
    } finally {
        setLoading(button, false);
    }
};

window.loadStaffProfiles = async () => {
    try {
        requirePermission(PERMISSIONS.MANAGE_STAFF);
        const [{ data, error }, branchesResult] = await Promise.all([
            repositories.getStaffProfiles(getScope()),
            repositories.getBranches(getScope())
        ]);
        if (error) throw error;
        if (branchesResult.error) throw branchesResult.error;

        state.branches = branchesResult.data || [];
        populateStaffBranchOptions(document.getElementById('staffBranch')?.value || state.branchId || '');

        const tableBody = document.getElementById('staffTableBody');
        if (!tableBody) return;

        const staffProfiles = [...(data || [])].sort((left, right) =>
            getProfileDisplayName(left).localeCompare(getProfileDisplayName(right))
        );

        tableBody.innerHTML = staffProfiles.map((profile) => `
            <tr>
                <td>${getProfileDisplayName(profile)}</td>
                <td>${profile.username || '-'}</td>
                <td>${getBranchLabel(profile.branch_id || profile.default_branch_id)}</td>
                <td>${prettifyRole(profile.role)}</td>
                <td>${profile.is_active === false ? 'Inactive' : 'Active'}</td>
                <td style="text-align:right;">
                    <button class="btn" style="background:#edf2f7; color:#2d3748;" onclick="editStaffUser('${profile.id}')">Edit</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="6" style="text-align:center; padding:20px;">No staff users found.</td></tr>';
    } catch (error) {
        handleError(error, 'Failed to load staff profiles');
    }
};

window.resetStaffForm = () => {
    document.getElementById('staffProfileId').value = '';
    document.getElementById('staffFullName').value = '';
    document.getElementById('staffUsername').value = '';
    document.getElementById('staffRole').value = ROLES.CASHIER;
    populateStaffBranchOptions(state.branchId || '');
    document.getElementById('staffPassword').value = '';
    document.getElementById('staffIsActive').value = 'true';
    document.getElementById('staffUsername').disabled = false;
    document.getElementById('staffFormTitle').innerText = 'Update Staff Profile';
    document.getElementById('saveStaffBtn').innerText = 'Save Profile';
    document.getElementById('cancelStaffBtn').style.display = 'none';
    if (appModalState.sourceId === 'staffFormCard') {
        closeAppModalImmediate();
    }
};

window.editStaffUser = async (profileId) => {
    try {
        requirePermission(PERMISSIONS.MANAGE_STAFF);
        const { data, error } = await repositories.getStaffProfiles(getScope());
        if (error) throw error;

        const profile = (data || []).find((entry) => String(entry.id) === String(profileId));
        if (!profile) throw new Error('Staff profile not found.');

        document.getElementById('staffProfileId').value = profile.id;
        document.getElementById('staffFullName').value = profile.full_name || profile.name || '';
        document.getElementById('staffUsername').value = profile.username || '';
        document.getElementById('staffRole').value = profile.role || ROLES.CASHIER;
        populateStaffBranchOptions(profile.branch_id || profile.default_branch_id || state.branchId || '');
        document.getElementById('staffPassword').value = '';
        document.getElementById('staffIsActive').value = profile.is_active === false ? 'false' : 'true';
        document.getElementById('staffUsername').disabled = true;
        document.getElementById('staffFormTitle').innerText = 'Edit Staff Profile';
        document.getElementById('saveStaffBtn').innerText = 'Update Profile';
        document.getElementById('cancelStaffBtn').style.display = 'inline-block';
        openHostedModal('Edit Staff Profile', 'staffFormCard', () => window.resetStaffForm());
    } catch (error) {
        handleError(error, 'Failed to load staff profile');
    }
};

window.saveStaffUser = async () => {
    const button = document.getElementById('saveStaffBtn');
    setLoading(button, true, 'Saving...');
    try {
        requirePermission(PERMISSIONS.MANAGE_STAFF);
        const profileId = document.getElementById('staffProfileId').value;
        const fullName = document.getElementById('staffFullName').value.trim();
        const username = document.getElementById('staffUsername').value.trim().toLowerCase();
        const role = document.getElementById('staffRole').value;
        const branchId = document.getElementById('staffBranch').value;
        const password = document.getElementById('staffPassword').value;
        const isActive = document.getElementById('staffIsActive').value === 'true';

        if (!fullName) throw new Error('Full name is required.');
        if (!profileId && !username) throw new Error('Username is required.');
        if (!Object.values(ROLES).includes(role)) throw new Error('Selected staff role is invalid.');
        if (!branchId) throw new Error('Branch assignment is required.');

        if (profileId) {
            const { error } = await repositories.updateStaffProfile(getScope(), profileId, {
                fullName,
                branchId,
                defaultBranchId: branchId,
                role,
                isActive
            });
            if (error) throw error;
            showAppToast('Staff profile updated.');
        } else {
            if (password) {
                throw new Error('Automatic staff creation is still paused. Create the Auth user manually in Supabase, then update the profile here.');
            }
            throw new Error('Automatic staff creation is still paused. Create the Auth user manually in Supabase, then update the profile here.');
        }

        window.resetStaffForm();
        await window.loadStaffProfiles();
    } catch (error) {
        handleError(error, 'Failed to save staff user');
    } finally {
        setLoading(button, false);
    }
};

window.changeMyPassword = async () => {
    const button = document.getElementById('changePasswordBtn');
    setLoading(button, true, 'Updating...');
    try {
        const password = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        if (!password || password.length < 6) throw new Error('New password must be at least 6 characters.');
        if (password !== confirmPassword) throw new Error('Passwords do not match.');

        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;

        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        showAppToast('Password updated successfully.');
    } catch (error) {
        handleError(error, 'Failed to update password');
    } finally {
        setLoading(button, false);
    }
};

window.resetRawForm = () => {
    document.getElementById('rawMaterialId').value = '';
    document.getElementById('rawCode').value = '';
    document.getElementById('rawName').value = '';
    document.getElementById('buyUnit').value = '';
    document.getElementById('storeUnit').value = '';
    document.getElementById('convFactor').value = '1';
    document.getElementById('buyPrice').value = '';
    document.getElementById('reorderLevel').value = '';
    document.getElementById('rawIsKeyShiftItem').checked = false;
    document.getElementById('rawFormTitle').innerText = 'Add New Raw Material';
    document.getElementById('cancelRawBtn').style.display = 'none';
    document.getElementById('saveRawBtn').innerText = 'Save Material';
    updateRawMaterialNameHint();
    if (appModalState.sourceId === 'rawMaterialFormCard') {
        closeAppModalImmediate();
    }
};

window.editRawMaterial = (id) => {
    requirePermission(PERMISSIONS.MANAGE_RAW_MATERIALS);
    const material = state.rawMaterials.find((entry) => String(entry.id) === String(id));
    if (!material) return;
    const splitName = splitMaterialName(material.name);
    document.getElementById('rawMaterialId').value = material.id;
    document.getElementById('rawCode').value = splitName.code || '';
    document.getElementById('rawName').value = splitName.name || '';
    document.getElementById('buyUnit').value = material.buy_unit || '';
    document.getElementById('storeUnit').value = material.store_unit || '';
    document.getElementById('convFactor').value = material.conversion_factor || 1;
    document.getElementById('buyPrice').value = material.price || '';
    document.getElementById('reorderLevel').value = material.reorder_level ?? '';
    document.getElementById('rawIsKeyShiftItem').checked = material.is_key_shift_item === true;
    document.getElementById('rawFormTitle').innerText = 'Edit Raw Material';
    document.getElementById('cancelRawBtn').style.display = 'inline-block';
    document.getElementById('saveRawBtn').innerText = 'Update Material';
    updateRawMaterialNameHint();
    openHostedModal('Edit Raw Material', 'rawMaterialFormCard', () => window.resetRawForm());
};

window.checkRawMaterialNameMatch = () => {
    updateRawMaterialNameHint();
};

window.deleteRawMaterial = async (id) => {
    if (!confirm('Are you sure you want to delete this raw material? This may fail if it is already used in receipts, recipes, or transfers.')) return;
    try {
        requirePermission(PERMISSIONS.MANAGE_RAW_MATERIALS);
        const { error } = await repositories.deleteRawMaterial(getScope(), id);
        if (error) throw error;
        showAppToast('Raw material deleted successfully.');
        window.resetRawForm();
        await loadRawMaterials();
        updateDropdowns();
    } catch (error) {
        handleError(error, 'Failed to delete raw material');
    }
};

window.switchReportView = (view) => {
    const isShiftReports = view === 'shift-reports';
    const isShiftRecall = view === 'shift-recall';
    const isShiftMode = isShiftReports || isShiftRecall;
    if (!isShiftMode && !hasPermission(state.permissions, PERMISSIONS.VIEW_FINANCIAL_REPORTS)) {
        handleError(new Error('You do not have access to financial reports.'), 'Access denied');
        return;
    }
    const shiftButton = document.getElementById('btnShiftReports');
    const shiftRecallButton = document.getElementById('btnShiftRecall');
    const financialButton = document.getElementById('btnFinancialReports');
    const shiftSection = document.getElementById('shiftReportsSection');
    const financialSection = document.getElementById('financialReportsSection');
    const pageTitle = document.getElementById('reportsPageTitle');
    const shiftRecallHelper = document.getElementById('shiftRecallHelper');

    if (shiftButton) {
        shiftButton.style.background = isShiftReports ? '#7092ae' : '#edf2f7';
        shiftButton.style.color = isShiftReports ? 'white' : '#2d3748';
    }

    if (shiftRecallButton) {
        shiftRecallButton.style.background = isShiftRecall ? '#7092ae' : '#edf2f7';
        shiftRecallButton.style.color = isShiftRecall ? 'white' : '#2d3748';
    }

    if (financialButton) {
        financialButton.style.background = isShiftMode ? '#edf2f7' : '#7092ae';
        financialButton.style.color = isShiftMode ? '#2d3748' : 'white';
    }

    if (shiftSection) shiftSection.style.display = isShiftMode ? 'block' : 'none';
    if (financialSection) financialSection.style.display = isShiftMode ? 'none' : 'block';
    if (shiftRecallHelper) shiftRecallHelper.style.display = isShiftRecall ? 'block' : 'none';
    if (pageTitle) {
        pageTitle.innerText = isShiftReports
            ? 'Shift Reports'
            : isShiftRecall
                ? 'Shift Recall'
                : 'Financial Reports';
    }
    updatePageBranchLabels();

    if (isShiftMode) {
        window.loadShiftReport();
    }
};

window.loadShiftReport = async () => {
    const reportStartDate = document.getElementById('reportStartDate').value;
    const reportEndDate = document.getElementById('reportEndDate').value;
    if (!reportStartDate || !reportEndDate) return;

    const tableBody = document.getElementById('shiftTableBody');
    const tableContainer = document.getElementById('shiftTableContainer');
    const detailView = document.getElementById('shiftDetailView');
    tableContainer.style.display = 'block';
    detailView.style.display = 'none';
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px;">Fetching shifts...</td></tr>';

      try {
          const reportScope = getReportScope();
          const { data: shifts, error } = await repositories.getShiftReportsByRange(reportScope, reportStartDate, reportEndDate);
          if (error) throw error;
          const closedShifts = annotateShiftsForDisplay(
              (shifts || []).filter((shift) => shift.total_sales !== null),
              state.shiftSystem
          );

        if (!closedShifts.length) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:#a0aec0;">No shifts recorded between ${reportStartDate} and ${reportEndDate}</td></tr>`;
            return;
        }

        tableBody.innerHTML = closedShifts.map((shift) => {
            const mpesaIncome = calculateMpesaIncome(shift.mpesa_float, shift.mpesa_closing, shift.mpesa_withdrawals);
            const totalIncome = calculateAccountedIncome({
                cashAtHand: shift.cash_at_hand,
                mpesaIncome,
                totalExpenses: shift.total_expenses,
                debtGiven: shift.total_debts,
                prevDebtsPaid: shift.debts_collected
            });
              const variance = calculateVariance(shift.total_sales, totalIncome);
              const shiftLabel = reportScope.useBranchScope
                  ? shift.shiftLabel
                  : `${getBranchName(shift.branch_id)} · ${shift.shiftLabel}`;

              return `
                  <tr style="border-bottom: 1px solid #edf2f7;">
                      <td style="padding:12px;">${formatLongDate(shift.created_at)}</td>
                      <td style="padding:12px;">${shiftLabel}</td>
                      <td style="padding:12px;">${shift.closed_by || 'Staff'}</td>
                      <td style="padding:12px; font-weight:bold;">${toNumber(shift.total_sales).toLocaleString()}</td>
                      <td style="padding:12px;">${mpesaIncome.toLocaleString()}</td>
                      <td style="padding:12px; ${getVarianceDisplayStyle(variance)}">${variance.toLocaleString()}</td>
                    <td style="padding:12px;"><button class="btn" onclick="viewShiftDetail('${shift.id}')" style="background:#274766; color:white; border:1px solid #1f3146; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:700;">Shift Recall</button></td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error(error);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#e53e3e; padding:20px;">Error: ${error.message}</td></tr>`;
    }
};

window.viewShiftDetail = async (shiftId) => {
    const tableContainer = document.getElementById('shiftTableContainer');
    const detailView = document.getElementById('shiftDetailView');
    const detailContent = document.getElementById('shiftDetailContent');
    tableContainer.style.display = 'none';
    detailView.style.display = 'block';
    detailContent.innerHTML = '<p style="text-align:center;">Loading shift recall...</p>';

    try {
        const baseScope = getScope();
        const [{ data: shift, error }, productsResult] = await Promise.all([
            repositories.getShiftById(baseScope, shiftId),
            repositories.getProducts(baseScope, { includeInactive: true })
        ]);
        if (error) throw error;
        if (productsResult.error) throw productsResult.error;

        const shiftScope = getScopeForBranch(shift.branch_id);
        const shiftDate = new Date(shift.created_at);
        const windowStart = new Date(shiftDate);
        windowStart.setDate(windowStart.getDate() - 7);
        const windowEnd = new Date(shiftDate);
        windowEnd.setDate(windowEnd.getDate() + 7);

        const [shiftInventoryResult, nearbyShiftsResult, barIssuesResult] = await Promise.all([
            repositories.getShiftInventory(shiftScope, shiftId),
            repositories.getShiftReportsByRange(shiftScope, toDateOnly(windowStart), toDateOnly(windowEnd)),
            isDirectSalesBranch(shift.branch_id)
                ? repositories.getBarStockIssues(shiftScope)
                : Promise.resolve({ data: [], error: null })
        ]);
        if (shiftInventoryResult.error) throw shiftInventoryResult.error;
        if (nearbyShiftsResult.error) throw nearbyShiftsResult.error;
        if (barIssuesResult.error) throw barIssuesResult.error;

        const sameBranchShifts = annotateShiftsForDisplay(
            (nearbyShiftsResult.data || []).filter((row) => String(row.branch_id || '') === String(shift.branch_id || '')),
            state.shiftSystem
        ).sort((left, right) => new Date(left.created_at) - new Date(right.created_at));

        const selectedIndex = sameBranchShifts.findIndex((row) => String(row.id) === String(shift.id));
        const previousShift = selectedIndex > 0 ? sameBranchShifts[selectedIndex - 1] : null;
        const nextShift = selectedIndex !== -1 && selectedIndex < sameBranchShifts.length - 1 ? sameBranchShifts[selectedIndex + 1] : null;

        const adjacentShiftIds = [previousShift?.id, nextShift?.id].filter(Boolean);
        const adjacentInventoryResult = adjacentShiftIds.length
            ? await repositories.getShiftInventoryForShiftIds(shiftScope, adjacentShiftIds)
            : { data: [], error: null };
        if (adjacentInventoryResult.error) throw adjacentInventoryResult.error;

        const previousInventoryRows = (adjacentInventoryResult.data || []).filter((row) => String(row.shift_id) === String(previousShift?.id || ''));
        const nextInventoryRows = (adjacentInventoryResult.data || []).filter((row) => String(row.shift_id) === String(nextShift?.id || ''));

        const shiftLabel = annotateShiftsForDisplay([shift], state.shiftSystem)?.[0]?.shiftLabel || '--';
        const recallRows = buildShiftRecallRows(shiftInventoryResult.data || [], productsResult.data || [], {
            useDirectSalesFallback: isDirectSalesBranch(shift.branch_id),
            previousInventoryRows,
            nextInventoryRows,
            barIssueRows: (barIssuesResult.data || []).filter((row) => String(row.shift_id || '') === String(shift.id))
        });

        detailContent.innerHTML = `
            <div style="background:white; padding:20px; border-radius:8px; border:1px solid #e2e8f0; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:12px;">
                    <div>
                        <h3 style="margin:0 0 4px 0;">Shift Recall</h3>
                        <div style="color:#64748b; font-size:12px;">Ref: ${shift.id.slice(0, 8)} | ${formatShiftRecallDate(shift.created_at)}</div>
                    </div>
                    <div style="display:inline-flex; align-items:center; gap:8px; background:#eff6ff; color:#1d4ed8; border-radius:999px; padding:8px 12px; font-weight:700;">
                        ${shiftLabel}
                    </div>
                </div>
                ${buildShiftRecallSummaryCards(shift, shiftLabel)}
                <div style="margin-bottom:12px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.04em; font-weight:700;">Item Detail</div>
                ${renderShiftRecallTable(recallRows, { savedTotalSales: shift.total_sales })}
                <div style="margin-top:12px; font-size:12px; color:#64748b;">
                    Use this view to inspect opening, added, closing, sold, price, and total for each item in the selected shift.
                </div>
            </div>
        `;
    } catch (error) {
        console.error(error);
        detailContent.innerHTML = `<p style="color:red; text-align:center;">Error: ${error.message}</p>`;
    }
};

async function loadAuditReportData(startDate, endDate) {
    const scope = getReportScope();
    const [
        shiftsResult,
        receiptsResult,
        supplyReceiptsResult,
        transfersResult,
        debtsResult,
        productsResult,
        recipesResult,
        rawMaterialsResult
    ] = await Promise.all([
        repositories.getShiftReportsByRange(scope, startDate, endDate),
        repositories.getStockReceiptsByRange(scope, startDate, endDate),
        repositories.getSupplyReceiptsByRange(scope, startDate, endDate),
        repositories.getStockTransfersByRange(scope, startDate, endDate),
        repositories.getDebtsByRange(scope, startDate, endDate),
        repositories.getProducts(scope),
        repositories.getRecipes(scope),
        repositories.getRawMaterials(scope)
    ]);

    if (shiftsResult.error) throw shiftsResult.error;
    if (receiptsResult.error) throw receiptsResult.error;
    if (supplyReceiptsResult.error) throw supplyReceiptsResult.error;
    if (transfersResult.error) throw transfersResult.error;
    if (debtsResult.error) throw debtsResult.error;
    if (productsResult.error) throw productsResult.error;
    if (recipesResult.error) throw recipesResult.error;
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;

    const closedShifts = annotateShiftsForDisplay(
        (shiftsResult.data || []).filter((shift) => shift.total_sales !== null),
        state.shiftSystem
    );

    const shiftInventoryResult = await repositories.getShiftInventoryForShiftIds(
        scope,
        closedShifts.map((shift) => shift.id)
    );
    if (shiftInventoryResult.error) throw shiftInventoryResult.error;

    return {
        shifts: closedShifts,
        stockReceipts: receiptsResult.data || [],
        supplyReceipts: supplyReceiptsResult.data || [],
        stockTransfers: transfersResult.data || [],
        debts: debtsResult.data || [],
        products: productsResult.data || [],
        recipes: recipesResult.data || [],
        rawMaterials: rawMaterialsResult.data || [],
        shiftInventory: shiftInventoryResult.data || []
    };
}

function buildRawItemsReceivedReport(data) {
    const materialMetaMap = new Map(
        (data.rawMaterials || []).map((material) => [
            String(material.name || '').trim().toLowerCase(),
            {
                buyUnit: material.buy_unit || '',
                storeUnit: material.store_unit || material.buy_unit || '',
                conversionFactor: Math.max(toNumber(material.conversion_factor), 1)
            }
        ])
    );
    const showBranch = isAllBranchesReportScope();
    const totalReceivedCost = data.stockReceipts.reduce((sum, row) => (
        sum + toNumber(row.total_received_cost ?? (toNumber(row.qty_received) * toNumber(row.buy_unit_price)))
    ), 0);
    const totalBuyQty = data.stockReceipts.reduce((sum, row) => sum + toNumber(row.qty_received), 0);
    const totalStoreQty = data.stockReceipts.reduce((sum, row) => (
        sum + toNumber(row.qty_posted_store ?? (toNumber(row.qty_received) * Math.max(toNumber(row.conversion_factor), 1)))
    ), 0);

    return {
        title: 'Raw Items Received',
        summary: [
            { label: 'Receipt Rows', value: String(data.stockReceipts.length) },
            { label: 'Total Received Cost', value: `KES ${formatMoney(totalReceivedCost)}` },
            { label: 'Total Buy Qty', value: formatQuantity(totalBuyQty, 4) },
            { label: 'Total Store Qty', value: formatQuantity(totalStoreQty, 4) }
        ],
        columns: [
            { key: 'date', label: 'Date' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'material_name', label: 'Material' },
            { key: 'qty_received_buy', label: 'Received Qty' },
            { key: 'received_cost', label: 'Received Cost' },
            { key: 'qty_posted_store', label: 'Store Qty Posted' },
            { key: 'store_unit_price', label: 'Store Unit Price' },
            { key: 'received_by', label: 'Received By' }
        ],
        rows: data.stockReceipts.map((row) => ({
            date: formatDateDisplay(row.created_at),
            ...(showBranch ? { branch: getBranchName(row.branch_id) } : {}),
            material_name: getDisplayMaterialName(row.material_name),
            qty_received_buy: `${toNumber(row.qty_received).toLocaleString()} ${(row.buy_unit || materialMetaMap.get(String(row.material_name || '').trim().toLowerCase())?.buyUnit || '')}`.trim(),
            received_cost: formatMoney(row.total_received_cost ?? (toNumber(row.qty_received) * toNumber(row.buy_unit_price ?? materialMetaMap.get(String(row.material_name || '').trim().toLowerCase())?.buyUnitPrice))),
            qty_posted_store: `${toNumber(row.qty_posted_store ?? (toNumber(row.qty_received) * Math.max(toNumber(row.conversion_factor ?? materialMetaMap.get(String(row.material_name || '').trim().toLowerCase())?.conversionFactor), 1))).toLocaleString()} ${(row.store_unit || materialMetaMap.get(String(row.material_name || '').trim().toLowerCase())?.storeUnit || '')}`.trim(),
            store_unit_price: formatMoney(row.store_unit_price ?? (toNumber(row.buy_unit_price ?? materialMetaMap.get(String(row.material_name || '').trim().toLowerCase())?.buyUnitPrice) / Math.max(toNumber(row.conversion_factor ?? materialMetaMap.get(String(row.material_name || '').trim().toLowerCase())?.conversionFactor), 1))),
            received_by: row.received_by || 'Staff'
        })),
        notes: [
            'Received Qty is what was entered in buy units.',
            'Store Qty Posted is the converted quantity applied to store stock in store units.',
            'Received Cost and Store Unit Price use the receipt-time snapshot when available.'
        ]
    };
}

function buildOperatingSuppliesReport(data) {
    const showBranch = isAllBranchesReportScope();
    const totalSupplyCost = (data.supplyReceipts || []).reduce((sum, row) => sum + toNumber(row.total_received_cost), 0);
    const totalSupplyQty = (data.supplyReceipts || []).reduce((sum, row) => sum + toNumber(row.qty_received), 0);
    const categoryCount = new Set((data.supplyReceipts || []).map((row) => String(row.category || 'General Supplies').trim().toLowerCase())).size;

    return {
        title: 'Operating Supplies Received',
        summary: [
            { label: 'Supply Receipts', value: String((data.supplyReceipts || []).length) },
            { label: 'Total Supply Cost', value: `KES ${formatMoney(totalSupplyCost)}` },
            { label: 'Total Qty Received', value: formatQuantity(totalSupplyQty, 4) },
            { label: 'Categories', value: String(categoryCount) }
        ],
        columns: [
            { key: 'date', label: 'Date' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'item_name', label: 'Item' },
            { key: 'category', label: 'Category' },
            { key: 'qty_received', label: 'Qty Received' },
            { key: 'total_cost', label: 'Total Cost' },
            { key: 'unit_cost', label: 'Unit Cost' },
            { key: 'received_by', label: 'Received By' },
            { key: 'notes', label: 'Notes' }
        ],
        rows: (data.supplyReceipts || []).map((row) => ({
            date: formatDateDisplay(row.created_at),
            ...(showBranch ? { branch: getBranchName(row.branch_id) } : {}),
            item_name: getDisplaySupplyItemName(row.item_name),
            category: row.category || 'General Supplies',
            qty_received: `${formatQuantity(row.qty_received)} ${row.buy_unit || ''}`.trim(),
            total_cost: formatMoney(row.total_received_cost),
            unit_cost: formatMoney(row.unit_cost),
            received_by: row.received_by || 'Staff',
            notes: row.notes || ''
        })),
        notes: [
            'Operating supplies are tracked separately from raw materials and are not available in the recipe matrix.',
            'New supply items can be created on entry during receiving.'
        ]
    };
}

function buildOutOfStockReport(data) {
    const showBranch = isAllBranchesReportScope();
    const rows = (data.rawMaterials || [])
        .filter((material) => toNumber(material.stock_level ?? material.current_stock) <= 0)
        .sort((left, right) => {
            const branchCompare = String(getBranchName(left.branch_id) || '').localeCompare(String(getBranchName(right.branch_id) || ''));
            if (showBranch && branchCompare !== 0) return branchCompare;
            return getDisplayMaterialName(left.name).localeCompare(getDisplayMaterialName(right.name));
        })
        .map((material) => {
            const currentStock = toNumber(material.stock_level ?? material.current_stock);
            const reorderLevel = material.reorder_level === null || material.reorder_level === undefined || material.reorder_level === ''
                ? '--'
                : `${formatQuantity(material.reorder_level)} ${material.store_unit || ''}`.trim();
            return {
                ...(showBranch ? { branch: getBranchName(material.branch_id) } : {}),
                item: getDisplayMaterialName(material.name),
                buy_unit: material.buy_unit || '--',
                store_unit: material.store_unit || '--',
                current_stock: `${formatQuantity(currentStock)} ${material.store_unit || ''}`.trim(),
                reorder_level: reorderLevel,
                latest_buy_price: formatMoney(material.price),
                status: currentStock < 0 ? 'Negative Stock' : 'Out of Stock'
            };
        });

    return {
        title: 'Out of Stock Items',
        summary: [
            { label: 'Out Of Stock Items', value: String(rows.length) },
            { label: 'Negative Stock Items', value: String(rows.filter((row) => row.status === 'Negative Stock').length) },
            { label: 'Zero Stock Items', value: String(rows.filter((row) => row.status === 'Out of Stock').length) }
        ],
        columns: [
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'item', label: 'Item' },
            { key: 'buy_unit', label: 'Buy Unit' },
            { key: 'store_unit', label: 'Store Unit' },
            { key: 'current_stock', label: 'Current Stock' },
            { key: 'reorder_level', label: 'Reorder Level' },
            { key: 'latest_buy_price', label: 'Latest Buy Price' },
            { key: 'status', label: 'Status' }
        ],
        rows,
        notes: [
            'This report uses the current live store balances for the selected branch scope.',
            'It is a current stock snapshot and does not depend on the chosen date range.',
            'Items with zero or negative stock are listed here.'
        ]
    };
}

function buildTransferHistoryReport(data) {
    const showBranch = isAllBranchesReportScope();
    const totalTransferredQty = (data.stockTransfers || []).reduce((sum, row) => sum + toNumber(row.qty), 0);
    const routeCount = new Set((data.stockTransfers || []).map((row) => `${row.from_branch_id || ''}::${row.to_branch_id || ''}`)).size;
    return {
        title: 'Transfer History',
        summary: [
            { label: 'Transfer Rows', value: String((data.stockTransfers || []).length) },
            { label: 'Total Qty Transferred', value: formatQuantity(totalTransferredQty, 4) },
            { label: 'Branch Routes', value: String(routeCount) }
        ],
        columns: [
            { key: 'date_time', label: 'Date / Time' },
            ...(showBranch ? [{ key: 'source_scope', label: 'Branch Scope' }] : []),
            { key: 'material_name', label: 'Material' },
            { key: 'from_branch', label: 'From Branch' },
            { key: 'to_branch', label: 'To Branch' },
            { key: 'qty', label: 'Qty' },
            { key: 'unit', label: 'Unit' },
            { key: 'created_by', label: 'Recorded By' },
            { key: 'notes', label: 'Notes' }
        ],
        rows: (data.stockTransfers || []).map((row) => ({
            date_time: formatDateTimeDisplay(row.created_at),
            ...(showBranch ? { source_scope: getBranchName(row.from_branch_id) } : {}),
            material_name: getDisplayMaterialName(row.material_name || ''),
            from_branch: getBranchName(row.from_branch_id),
            to_branch: getBranchName(row.to_branch_id),
            qty: formatQuantity(row.qty),
            unit: row.unit || '',
            created_by: row.created_by || 'Staff',
            notes: row.notes || ''
        })),
        notes: [
            'This report lists branch-to-branch raw material transfers recorded in the selected period.',
            'Quantities are shown in store units.'
        ]
    };
}

function buildExpensesSummaryReport(data) {
    const showBranch = isAllBranchesReportScope();
    const totalExpenses = data.shifts.reduce((sum, shift) => sum + toNumber(shift.total_expenses), 0);
    const shiftCount = data.shifts.length;
    return {
        title: 'Expenses Summary',
        summary: [
            { label: 'Closed Shifts', value: String(shiftCount) },
            { label: 'Total Expenses', value: `KES ${formatMoney(totalExpenses)}` },
            { label: 'Average Per Shift', value: `KES ${formatMoney(shiftCount ? totalExpenses / shiftCount : 0)}` }
        ],
        columns: [
            { key: 'date', label: 'Date' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'shift', label: 'Shift' },
            { key: 'staff', label: 'Staff' },
            { key: 'expenses', label: 'Expenses Total' }
        ],
        rows: data.shifts.map((shift) => ({
            date: formatDateDisplay(shift.created_at),
            ...(showBranch ? { branch: getBranchName(shift.branch_id) } : {}),
            shift: shift.shiftLabel,
            staff: shift.closed_by || 'Staff',
            expenses: toNumber(shift.total_expenses).toLocaleString()
        })),
        notes: [
            'Current schema stores expense totals at shift level. Individual expense line dates/descriptions are not available for export yet.'
        ]
    };
}

function buildDebtsSummaryReport(data) {
    const showBranch = isAllBranchesReportScope();
    const totalDebtGiven = data.shifts.reduce((sum, shift) => sum + toNumber(shift.total_debts), 0);
    const totalDebtPaid = data.shifts.reduce((sum, shift) => sum + toNumber(shift.debts_collected), 0);
    const netDebtMovement = totalDebtGiven - totalDebtPaid;
    return {
        title: 'Debt Totals by Shift',
        summary: [
            { label: 'Debt Given', value: `KES ${formatMoney(totalDebtGiven)}` },
            { label: 'Debt Paid', value: `KES ${formatMoney(totalDebtPaid)}` },
            { label: 'Net Debt Movement', value: `KES ${formatMoney(netDebtMovement)}`, style: getVarianceDisplayStyle(-netDebtMovement) }
        ],
        columns: [
            { key: 'date', label: 'Date' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'shift', label: 'Shift' },
            { key: 'staff', label: 'Staff' },
            { key: 'debts_given', label: 'Debts Given' },
            { key: 'debts_paid', label: 'Debts Paid' }
        ],
        rows: data.shifts.map((shift) => ({
            date: formatDateDisplay(shift.created_at),
            ...(showBranch ? { branch: getBranchName(shift.branch_id) } : {}),
            shift: shift.shiftLabel,
            staff: shift.closed_by || 'Staff',
            debts_given: toNumber(shift.total_debts).toLocaleString(),
            debts_paid: toNumber(shift.debts_collected).toLocaleString()
        })),
        notes: [
            'This report shows shift-level debt totals.',
            'Use Debt Transactions or Debt Summary by Client for detailed debtor records.'
        ]
    };
}

function buildDebtTransactionsReport(data) {
    const shiftMap = new Map(data.shifts.map((shift) => [String(shift.id), shift]));
    const showBranch = isAllBranchesReportScope();
    const totalGiven = data.debts.reduce((sum, row) => sum + (row.transaction_type === 'paid' ? 0 : toNumber(row.amount)), 0);
    const totalPaid = data.debts.reduce((sum, row) => sum + (row.transaction_type === 'paid' ? toNumber(row.amount) : 0), 0);

    return {
        title: 'Debt Transactions',
        summary: [
            { label: 'Transaction Rows', value: String(data.debts.length) },
            { label: 'Total Given', value: `KES ${formatMoney(totalGiven)}` },
            { label: 'Total Paid', value: `KES ${formatMoney(totalPaid)}` }
        ],
        columns: [
            { key: 'date_time', label: 'Date / Time' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'shift', label: 'Shift' },
            { key: 'type', label: 'Type' },
            { key: 'client_name', label: 'Client Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'amount', label: 'Amount' },
            { key: 'notes', label: 'Notes' },
            { key: 'staff', label: 'Staff' }
        ],
        rows: data.debts.map((row) => {
            const shift = shiftMap.get(String(row.shift_id));
            return {
                date_time: formatDateTimeDisplay(row.created_at),
                ...(showBranch ? { branch: getBranchName(row.branch_id || shift?.branch_id) } : {}),
                shift: shift?.shiftLabel || '',
                type: row.transaction_type === 'paid' ? 'Debt Paid' : 'Debt Given',
                client_name: row.client_name || '',
                phone: row.phone || '',
                amount: toNumber(row.amount).toLocaleString(),
                notes: row.notes || '',
                staff: row.created_by || shift?.closed_by || 'Staff'
            };
        }),
        notes: [
            'This report lists individual debt rows entered during the selected period.'
        ]
    };
}

function buildDebtSummaryByClientReport(data) {
    const grouped = new Map();

    data.debts.forEach((row) => {
        const clientName = String(row.client_name || '').trim();
        const phone = String(row.phone || '').trim();
        const key = `${clientName.toLowerCase()}::${phone}`;
        const existing = grouped.get(key) || {
            client_name: clientName || 'Unknown',
            phone: phone || '',
            debt_given: 0,
            debt_paid: 0,
            outstanding_balance: 0
        };

        if (row.transaction_type === 'paid') {
            existing.debt_paid += toNumber(row.amount);
        } else {
            existing.debt_given += toNumber(row.amount);
        }

        existing.outstanding_balance = existing.debt_given - existing.debt_paid;
        grouped.set(key, existing);
    });

    const groupedValues = [...grouped.values()].sort((left, right) => right.outstanding_balance - left.outstanding_balance);
    const totalDebtGiven = groupedValues.reduce((sum, row) => sum + row.debt_given, 0);
    const totalDebtPaid = groupedValues.reduce((sum, row) => sum + row.debt_paid, 0);
    const outstandingBalance = groupedValues.reduce((sum, row) => sum + row.outstanding_balance, 0);

    return {
        title: 'Debt Summary by Client',
        summary: [
            { label: 'Clients', value: String(groupedValues.length) },
            { label: 'Debt Given', value: `KES ${formatMoney(totalDebtGiven)}` },
            { label: 'Debt Paid', value: `KES ${formatMoney(totalDebtPaid)}` },
            { label: 'Outstanding Balance', value: `KES ${formatMoney(outstandingBalance)}`, style: getVarianceDisplayStyle(-outstandingBalance) }
        ],
        columns: [
            { key: 'client_name', label: 'Client Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'debt_given', label: 'Debt Given' },
            { key: 'debt_paid', label: 'Debt Paid' },
            { key: 'outstanding_balance', label: 'Outstanding Balance' }
        ],
        rows: groupedValues
            .map((row) => ({
                client_name: row.client_name,
                phone: row.phone,
                debt_given: row.debt_given.toLocaleString(),
                debt_paid: row.debt_paid.toLocaleString(),
                outstanding_balance: row.outstanding_balance.toLocaleString()
            })),
        notes: [
            'Outstanding balance is calculated as total debt given minus total debt paid for each client in the selected period.'
        ]
    };
}

function buildSalesByItemReport(data) {
    const productMap = new Map(data.products.map((product) => [String(product.id), product]));
    const grouped = new Map();

    data.shiftInventory.forEach((row) => {
        const product = productMap.get(String(row.product_id));
        if (!product) return;

        const key = String(row.product_id);
        const existing = grouped.get(key) || {
            item: getDisplayProductName(product.name),
            qty_sold: 0,
            unit_price: toNumber(product.price),
            sales_total: 0
        };

        const soldQty = toNumber(row.sold_qty);
        existing.qty_sold += soldQty;
        existing.sales_total += soldQty * toNumber(product.price);
        grouped.set(key, existing);
    });

    const groupedValues = [...grouped.values()].sort((left, right) => right.sales_total - left.sales_total);
    const totalQtySold = groupedValues.reduce((sum, row) => sum + row.qty_sold, 0);
    const totalSales = groupedValues.reduce((sum, row) => sum + row.sales_total, 0);
    const topItem = groupedValues[0];
    return {
        title: 'Sales by Item',
        summary: [
            { label: 'Items Sold', value: String(groupedValues.length) },
            { label: 'Total Qty Sold', value: formatQuantity(totalQtySold, 4) },
            { label: 'Total Sales', value: `KES ${formatMoney(totalSales)}` },
            { label: 'Top Item', value: topItem ? topItem.item : '--' }
        ],
        columns: [
            { key: 'item', label: 'Item' },
            { key: 'qty_sold', label: 'Qty Sold' },
            { key: 'unit_price', label: 'Unit Price' },
            { key: 'sales_total', label: 'Sales Total' }
        ],
        rows: groupedValues
            .map((row) => ({
                ...row,
                unit_price: row.unit_price.toLocaleString(),
                sales_total: row.sales_total.toLocaleString()
            }))
    };
}

function buildSalesSummaryReport(data) {
    const showBranch = isAllBranchesReportScope();
    const rows = data.shifts.map((shift) => ({
        date: formatDateDisplay(shift.created_at),
        ...(showBranch ? { branch: getBranchName(shift.branch_id) } : {}),
        shift: shift.shiftLabel,
        staff: shift.closed_by || 'Staff',
        total_sales: toNumber(shift.total_sales).toLocaleString(),
        expenses: toNumber(shift.total_expenses).toLocaleString(),
        variance: toNumber(shift.variance).toLocaleString()
    }));

    const totals = data.shifts.reduce((accumulator, shift) => ({
        totalSales: accumulator.totalSales + toNumber(shift.total_sales),
        expenses: accumulator.expenses + toNumber(shift.total_expenses),
        variance: accumulator.variance + toNumber(shift.variance)
    }), { totalSales: 0, expenses: 0, variance: 0 });

    rows.push({
        date: 'TOTAL',
        ...(showBranch ? { branch: '' } : {}),
        shift: '',
        staff: '',
        total_sales: totals.totalSales.toLocaleString(),
        expenses: totals.expenses.toLocaleString(),
        variance: totals.variance.toLocaleString()
    });

    return {
        title: 'Sales Summary',
        summary: [
            { label: 'Closed Shifts', value: String(data.shifts.length) },
            { label: 'Total Sales', value: `KES ${formatMoney(totals.totalSales)}` },
            { label: 'Total Expenses', value: `KES ${formatMoney(totals.expenses)}` },
            { label: 'Net Variance', value: `KES ${formatMoney(totals.variance)}`, style: getVarianceDisplayStyle(totals.variance) }
        ],
        columns: [
            { key: 'date', label: 'Date' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'shift', label: 'Shift' },
            { key: 'staff', label: 'Staff' },
            { key: 'total_sales', label: 'Total Sales' },
            { key: 'expenses', label: 'Expenses' },
            { key: 'variance', label: 'Variance' }
        ],
        rows
    };
}

function buildVarianceDetailReport(data) {
    const showBranch = isAllBranchesReportScope();
    const shiftVarianceValues = data.shifts.map((shift) => {
        const mpesaOpening = toNumber(shift.mpesa_float);
        const mpesaClosing = toNumber(shift.mpesa_closing);
        const mpesaWithdrawals = toNumber(shift.mpesa_withdrawals);
        const mpesaIncome = calculateMpesaIncome(mpesaOpening, mpesaClosing, mpesaWithdrawals);
        const cashAtHand = toNumber(shift.cash_at_hand);
        const expenses = toNumber(shift.total_expenses);
        const debtGiven = toNumber(shift.total_debts);
        const debtPaid = toNumber(shift.debts_collected);
        const accountedIncome = calculateAccountedIncome({
            cashAtHand,
            mpesaIncome,
            totalExpenses: expenses,
            debtGiven,
            prevDebtsPaid: debtPaid
        });
        const totalSales = toNumber(shift.total_sales);
        return calculateVariance(totalSales, accountedIncome);
    });
    const rows = data.shifts.map((shift) => {
        const mpesaOpening = toNumber(shift.mpesa_float);
        const mpesaClosing = toNumber(shift.mpesa_closing);
        const mpesaWithdrawals = toNumber(shift.mpesa_withdrawals);
        const mpesaIncome = calculateMpesaIncome(mpesaOpening, mpesaClosing, mpesaWithdrawals);
        const cashAtHand = toNumber(shift.cash_at_hand);
        const expenses = toNumber(shift.total_expenses);
        const debtGiven = toNumber(shift.total_debts);
        const debtPaid = toNumber(shift.debts_collected);
        const accountedIncome = calculateAccountedIncome({
            cashAtHand,
            mpesaIncome,
            totalExpenses: expenses,
            debtGiven,
            prevDebtsPaid: debtPaid
        });
        const totalSales = toNumber(shift.total_sales);
        const variance = calculateVariance(totalSales, accountedIncome);

        return {
            date: formatDateDisplay(shift.created_at),
            ...(showBranch ? { branch: getBranchName(shift.branch_id) } : {}),
            shift: shift.shiftLabel,
            staff: shift.closed_by || 'Staff',
            mpesa_opening: mpesaOpening.toLocaleString(),
            mpesa_closing: mpesaClosing.toLocaleString(),
            mpesa_withdrawals: mpesaWithdrawals.toLocaleString(),
            mpesa_income: mpesaIncome.toLocaleString(),
            cash_at_hand: cashAtHand.toLocaleString(),
            expenses: expenses.toLocaleString(),
            debt_given: debtGiven.toLocaleString(),
            debt_paid: debtPaid.toLocaleString(),
            accounted_income: accountedIncome.toLocaleString(),
            total_sales: totalSales.toLocaleString(),
            variance: variance.toLocaleString()
        };
    });

    const totals = data.shifts.reduce((accumulator, shift) => {
        const mpesaOpening = toNumber(shift.mpesa_float);
        const mpesaClosing = toNumber(shift.mpesa_closing);
        const mpesaWithdrawals = toNumber(shift.mpesa_withdrawals);
        const mpesaIncome = calculateMpesaIncome(mpesaOpening, mpesaClosing, mpesaWithdrawals);
        const cashAtHand = toNumber(shift.cash_at_hand);
        const expenses = toNumber(shift.total_expenses);
        const debtGiven = toNumber(shift.total_debts);
        const debtPaid = toNumber(shift.debts_collected);
        const accountedIncome = calculateAccountedIncome({
            cashAtHand,
            mpesaIncome,
            totalExpenses: expenses,
            debtGiven,
            prevDebtsPaid: debtPaid
        });
        const totalSales = toNumber(shift.total_sales);
        const variance = calculateVariance(totalSales, accountedIncome);

        return {
            mpesaOpening: accumulator.mpesaOpening + mpesaOpening,
            mpesaClosing: accumulator.mpesaClosing + mpesaClosing,
            mpesaWithdrawals: accumulator.mpesaWithdrawals + mpesaWithdrawals,
            mpesaIncome: accumulator.mpesaIncome + mpesaIncome,
            cashAtHand: accumulator.cashAtHand + cashAtHand,
            expenses: accumulator.expenses + expenses,
            debtGiven: accumulator.debtGiven + debtGiven,
            debtPaid: accumulator.debtPaid + debtPaid,
            accountedIncome: accumulator.accountedIncome + accountedIncome,
            totalSales: accumulator.totalSales + totalSales,
            variance: accumulator.variance + variance
        };
    }, {
        mpesaOpening: 0,
        mpesaClosing: 0,
        mpesaWithdrawals: 0,
        mpesaIncome: 0,
        cashAtHand: 0,
        expenses: 0,
        debtGiven: 0,
        debtPaid: 0,
        accountedIncome: 0,
        totalSales: 0,
        variance: 0
    });

    rows.push({
        date: 'TOTAL',
        ...(showBranch ? { branch: '' } : {}),
        shift: '',
        staff: '',
        mpesa_opening: totals.mpesaOpening.toLocaleString(),
        mpesa_closing: totals.mpesaClosing.toLocaleString(),
        mpesa_withdrawals: totals.mpesaWithdrawals.toLocaleString(),
        mpesa_income: totals.mpesaIncome.toLocaleString(),
        cash_at_hand: totals.cashAtHand.toLocaleString(),
        expenses: totals.expenses.toLocaleString(),
        debt_given: totals.debtGiven.toLocaleString(),
        debt_paid: totals.debtPaid.toLocaleString(),
        accounted_income: totals.accountedIncome.toLocaleString(),
        total_sales: totals.totalSales.toLocaleString(),
        variance: totals.variance.toLocaleString()
    });

    return {
        title: 'Variance Detail',
        summary: [
            { label: 'Shortage Shifts', value: String(shiftVarianceValues.filter((value) => value < 0).length) },
            { label: 'Overage Shifts', value: String(shiftVarianceValues.filter((value) => value > 0).length) },
            { label: 'Accounted Income', value: `KES ${formatMoney(totals.accountedIncome)}` },
            { label: 'Net Variance', value: `KES ${formatMoney(totals.variance)}`, style: getVarianceDisplayStyle(totals.variance) }
        ],
        columns: [
            { key: 'date', label: 'Date' },
            ...(showBranch ? [{ key: 'branch', label: 'Branch' }] : []),
            { key: 'shift', label: 'Shift' },
            { key: 'staff', label: 'Staff' },
            { key: 'mpesa_opening', label: 'M-Pesa Opening' },
            { key: 'mpesa_closing', label: 'M-Pesa Closing' },
            { key: 'mpesa_withdrawals', label: 'Withdrawals' },
            { key: 'mpesa_income', label: 'M-Pesa Income' },
            { key: 'cash_at_hand', label: 'Cash at Hand' },
            { key: 'expenses', label: 'Expenses' },
            { key: 'debt_given', label: 'Debt Given' },
            { key: 'debt_paid', label: 'Debt Paid' },
            { key: 'accounted_income', label: 'Accounted Income' },
            { key: 'total_sales', label: 'Total Sales' },
            { key: 'variance', label: 'Variance' }
        ],
        rows,
        notes: [
            'This report shows the full reconciliation breakdown used to arrive at variance for each closed shift.',
            'Variance is calculated as Accounted Income minus Total Sales.'
        ]
    };
}

function buildRawConsumptionReport(data) {
    const productMap = new Map(data.products.map((product) => [String(product.id), product]));
    const rawMaterialMap = new Map(data.rawMaterials.map((material) => [String(material.name || '').trim().toLowerCase(), material]));
    const recipeMap = data.recipes.reduce((accumulator, recipe) => {
        const key = String(recipe.finished_item_name || '').trim().toLowerCase();
        const list = accumulator.get(key) || [];
        list.push(recipe);
        accumulator.set(key, list);
        return accumulator;
    }, new Map());

    const grouped = new Map();

    data.shiftInventory.forEach((row) => {
        const product = productMap.get(String(row.product_id));
        if (!product) return;
        const recipes = recipeMap.get(String(product.name || '').trim().toLowerCase()) || [];
        const producedQty = toNumber(row.added_today);
        if (producedQty <= 0) return;

        recipes.forEach((recipe) => {
            const materialKey = String(recipe.material_name || '').trim().toLowerCase();
            const material = rawMaterialMap.get(materialKey);
            const consumedQty = producedQty * toNumber(recipe.qty_per_unit);
            const unitCost = material ? toNumber(material.price) / Math.max(toNumber(material.conversion_factor), 1) : 0;
            const existing = grouped.get(materialKey) || {
                material_name: getDisplayMaterialName(recipe.material_name),
                store_unit: material?.store_unit || '',
                consumed_qty: 0,
                unit_cost: unitCost,
                estimated_cost: 0
            };

            existing.consumed_qty += consumedQty;
            existing.estimated_cost += consumedQty * unitCost;
            grouped.set(materialKey, existing);
        });
    });

    return {
        title: 'Raw Consumption Estimate',
        summary: [
            { label: 'Raw Items Involved', value: String(grouped.size) },
            { label: 'Estimated Raw Cost', value: `KES ${formatMoney([...grouped.values()].reduce((sum, row) => sum + row.estimated_cost, 0))}` }
        ],
        columns: [
            { key: 'material_name', label: 'Material' },
            { key: 'store_unit', label: 'Store Unit' },
            { key: 'consumed_qty', label: 'Consumed Qty' },
            { key: 'unit_cost', label: 'Unit Cost' },
            { key: 'estimated_cost', label: 'Estimated Cost' }
        ],
        rows: [...grouped.values()].map((row) => ({
            material_name: getDisplayMaterialName(row.material_name),
            store_unit: row.store_unit,
            consumed_qty: row.consumed_qty.toFixed(4),
            unit_cost: row.unit_cost.toLocaleString(),
            estimated_cost: row.estimated_cost.toLocaleString()
        })),
        notes: [
            'This is a theoretical consumption estimate, not a stock-ledger reconciliation.',
            'It is calculated from recipe matrix usage multiplied by kitchen output for the selected period.'
        ]
    };
}

function buildKitchenVsSalesReport(data) {
    const productMap = new Map(data.products.map((product) => [String(product.id), product]));
    const grouped = new Map();

    data.shiftInventory.forEach((row) => {
        const product = productMap.get(String(row.product_id));
        if (!product) return;

        const key = String(row.product_id);
        const existing = grouped.get(key) || {
            item: getDisplayProductName(product.name),
            kitchen_out: 0,
            sold_qty: 0,
            variance: 0
        };

        existing.kitchen_out += toNumber(row.added_today);
        existing.sold_qty += toNumber(row.sold_qty);
        existing.variance = existing.kitchen_out - existing.sold_qty;
        grouped.set(key, existing);
    });

    return {
        title: 'Kitchen vs Sales Comparison',
        summary: [
            { label: 'Items Compared', value: String(grouped.size) },
            { label: 'Kitchen Output', value: formatQuantity([...grouped.values()].reduce((sum, row) => sum + row.kitchen_out, 0), 4) },
            { label: 'Sold Qty', value: formatQuantity([...grouped.values()].reduce((sum, row) => sum + row.sold_qty, 0), 4) },
            { label: 'Net Variance', value: formatQuantity([...grouped.values()].reduce((sum, row) => sum + row.variance, 0), 4) }
        ],
        columns: [
            { key: 'item', label: 'Item' },
            { key: 'kitchen_out', label: 'Kitchen Out' },
            { key: 'sold_qty', label: 'Sold Qty' },
            { key: 'variance', label: 'Variance' }
        ],
        rows: [...grouped.values()].map((row) => ({
            item: row.item,
            kitchen_out: row.kitchen_out,
            sold_qty: row.sold_qty,
            variance: row.variance
        })),
        notes: [
            'This is a comparison report, not a full stock variance report.',
            'It compares kitchen output against sold quantity for the selected period and does not include opening stock.'
        ]
    };
}

function buildProfitLossReport(data) {
    const salesByItem = buildSalesByItemReport(data);
    const rawConsumption = buildRawConsumptionReport(data);

    const totalSales = salesByItem.rows.reduce((sum, row) => sum + toNumber(String(row.sales_total).replace(/,/g, '')), 0);
    const rawCost = rawConsumption.rows.reduce((sum, row) => sum + toNumber(String(row.estimated_cost).replace(/,/g, '')), 0);
    const expenses = data.shifts.reduce((sum, shift) => sum + toNumber(shift.total_expenses), 0);
    const grossProfit = totalSales - rawCost;
    const netProfit = grossProfit - expenses;

    return {
        title: 'Estimated Profit / Loss',
        summary: [
            { label: 'Total Sales', value: `KES ${formatMoney(totalSales)}` },
            { label: 'Estimated Raw Cost', value: `KES ${formatMoney(rawCost)}` },
            { label: 'Operating Expenses', value: `KES ${formatMoney(expenses)}` },
            { label: 'Net Profit / Loss', value: `KES ${formatMoney(netProfit)}`, style: getVarianceDisplayStyle(netProfit) }
        ],
        columns: [
            { key: 'metric', label: 'Metric' },
            { key: 'value', label: 'Value' }
        ],
        rows: [
            { metric: 'Total Sales', value: totalSales.toLocaleString() },
            { metric: 'Estimated Raw Material Cost', value: rawCost.toLocaleString() },
            { metric: 'Gross Profit', value: grossProfit.toLocaleString() },
            { metric: 'Operating Expenses', value: expenses.toLocaleString() },
            { metric: 'Estimated Net Profit / Loss', value: netProfit.toLocaleString() }
        ],
        notes: [
            'This is an operating estimate, not a full accounting profit and loss statement.',
            'It uses sales, estimated raw material consumption cost from the recipe matrix, and recorded shift expense totals.',
            'It does not yet include broader overheads such as rent, salaries, utilities, repairs, or bank-paid expenses.'
        ]
    };
}

function buildAuditReport(reportType, data) {
    switch (reportType) {
    case 'raw-items-received':
        return buildRawItemsReceivedReport(data);
    case 'operating-supplies':
        return buildOperatingSuppliesReport(data);
    case 'out-of-stock':
        return buildOutOfStockReport(data);
    case 'transfer-history':
        return buildTransferHistoryReport(data);
    case 'expenses-summary':
        return buildExpensesSummaryReport(data);
    case 'debts-summary':
        return buildDebtsSummaryReport(data);
    case 'debt-transactions':
        return buildDebtTransactionsReport(data);
    case 'debt-summary-client':
        return buildDebtSummaryByClientReport(data);
    case 'sales-by-item':
        return buildSalesByItemReport(data);
    case 'sales-summary':
        return buildSalesSummaryReport(data);
    case 'variance-detail':
        return buildVarianceDetailReport(data);
    case 'raw-consumption':
        return buildRawConsumptionReport(data);
    case 'kitchen-vs-sales':
        return buildKitchenVsSalesReport(data);
    case 'profit-loss':
        return buildProfitLossReport(data);
    default:
        throw new Error('Unsupported report type selected.');
    }
}

window.previewAuditReport = async () => {
    const button = document.getElementById('previewAuditReportBtn');
    setLoading(button, true, 'Preparing...');
    try {
        const reportStartDate = document.getElementById('reportStartDate').value;
        const reportEndDate = document.getElementById('reportEndDate').value;
        const reportType = document.getElementById('auditReportType').value;
        requirePermission(reportType === 'raw-items-received' || reportType === 'sales-summary' || reportType === 'sales-by-item'
            ? PERMISSIONS.VIEW_FINANCIAL_REPORTS
            : PERMISSIONS.VIEW_FINANCIAL_REPORTS);
        if (!reportStartDate || !reportEndDate) throw new Error('Choose a start date and end date first.');

        const data = await loadAuditReportData(reportStartDate, reportEndDate);
        currentAuditReport = buildAuditReport(reportType, data);
        renderAuditReportPreview(currentAuditReport);
        setAuditReportStatus(`Preview ready for ${currentAuditReport.title}.`);
    } catch (error) {
        currentAuditReport = null;
        renderAuditReportPreview({ rows: [] });
        setAuditReportStatus(error.message || 'Failed to prepare report.', true);
        handleError(error, 'Failed to prepare audit report');
    } finally {
        setLoading(button, false);
    }
};

window.exportAuditReportCsv = async () => {
    const button = document.getElementById('exportAuditCsvBtn');
    setLoading(button, true, 'Exporting...');
    try {
        requirePermission(PERMISSIONS.EXPORT_REPORTS);
        if (!currentAuditReport) {
            await window.previewAuditReport();
        }

        if (!currentAuditReport?.rows?.length) {
            throw new Error('Preview a report with data before exporting.');
        }

        const reportStartDate = document.getElementById('reportStartDate').value;
        const reportEndDate = document.getElementById('reportEndDate').value;
        const safeTitle = currentAuditReport.title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        downloadCsv(`${safeTitle}_${reportStartDate}_to_${reportEndDate}.csv`, currentAuditReport.columns, currentAuditReport.rows);
        setAuditReportStatus(`CSV exported for ${currentAuditReport.title}.`);
    } catch (error) {
        setAuditReportStatus(error.message || 'Export failed.', true);
        handleError(error, 'Failed to export audit report');
    } finally {
        setLoading(button, false);
    }
};

window.exportReportPDF = () => {
    const element = document.getElementById('shiftDetailContent');
    if (!element) {
        alert('Nothing to export yet.');
        return;
    }
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    html2pdf().set({
        margin: 10,
        filename: `Shift_Report_${startDate}_to_${endDate}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(element).save();
};

window.addKitchenDraftRow = () => {
    ensureKitchenDrafts();
    state.kitchenDrafts = [...state.kitchenDrafts, createKitchenDraftRow()];
    renderKitchenBatchInputs();
};

window.removeKitchenDraftRow = (index) => {
    ensureKitchenDrafts();
    state.kitchenDrafts = state.kitchenDrafts.filter((_, rowIndex) => rowIndex !== index);
    ensureKitchenDrafts();
    renderKitchenBatchInputs();
};

window.updateKitchenDraftRow = (index, field, value) => {
    ensureKitchenDrafts();
    state.kitchenDrafts = state.kitchenDrafts.map((row, rowIndex) => (
        rowIndex === index
            ? { ...row, [field]: field === 'qty' ? value : value }
            : row
    ));
    if (field !== 'productSearch') {
        renderKitchenBatchInputs();
    }
};

window.syncKitchenDraftQty = (index, value) => {
    syncKitchenDraftQty(index, value);
};

window.backToShiftTable = () => {
    document.getElementById('shiftTableContainer').style.display = 'block';
    document.getElementById('shiftDetailView').style.display = 'none';
};

window.getOpeningBalances = () => {
    const carry = getCarryForwardBalances(state.currentShift);
    return { mpesa: carry.mpesaBf, cash: carry.cashBf };
};

window.updateItemField = (id, field, value) => {
    const item = state.items.find((entry) => String(entry.id) === String(id));
    if (item) item[field] = toNumber(value);
};

document.getElementById('postBtn')?.addEventListener('click', window.processReverseDispatch);
