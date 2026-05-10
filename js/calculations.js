import { DEFAULT_SHIFT_SYSTEM } from './state.js';

function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

function toDateOnly(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().split('T')[0];
}

export function normalizeShiftSystem(value) {
    return Number(value) === 2 ? 2 : DEFAULT_SHIFT_SYSTEM;
}

export function calculateSoldQty({
    openingQty = 0,
    producedQty = 0,
    receivedQty = 0,
    closingQty = 0,
    transferredOutQty = 0,
    transferredInQty = 0
}) {
    return Math.max(
        0,
        toNumber(openingQty) +
        toNumber(producedQty) +
        toNumber(receivedQty) -
        toNumber(closingQty) -
        toNumber(transferredOutQty) +
        toNumber(transferredInQty)
    );
}

export function calculateMpesaIncome(opening, closing, withdrawals) {
    return toNumber(closing) + toNumber(withdrawals) - toNumber(opening);
}

export function calculateAccountedIncome({
    cashAtHand = 0,
    mpesaIncome = 0,
    totalExpenses = 0,
    debtGiven = 0,
    prevDebtsPaid = 0
}) {
    return (
        toNumber(cashAtHand) +
        toNumber(mpesaIncome) +
        toNumber(totalExpenses) +
        toNumber(debtGiven) -
        toNumber(prevDebtsPaid)
    );
}

export function calculateVariance(totalSales, accountedIncome) {
    return toNumber(accountedIncome) - toNumber(totalSales);
}

export function getCarryForwardBalances(previousShift) {
    const isOpenShift = previousShift?.total_sales === null || previousShift?.total_sales === undefined;

    return {
        cashBf: isOpenShift
            ? toNumber(previousShift?.cash_at_hand ?? previousShift?.cash_bf ?? previousShift?.cash_total ?? 0)
            : toNumber(previousShift?.cash_at_hand ?? previousShift?.cash_total ?? previousShift?.cash_bf ?? 0),
        mpesaBf: isOpenShift
            ? toNumber(previousShift?.mpesa_float ?? previousShift?.mpesa_opening ?? 0)
            : toNumber(previousShift?.mpesa_closing ?? previousShift?.mpesa_float ?? previousShift?.mpesa_opening ?? 0)
    };
}

export function getNextShiftSeed(previousShift, configuredShiftSystem = DEFAULT_SHIFT_SYSTEM, today = new Date()) {
    const shiftSystem = normalizeShiftSystem(configuredShiftSystem);
    const carryForward = getCarryForwardBalances(previousShift);

    if (!previousShift) {
        return {
            shiftType: shiftSystem === 2 ? 'DAY' : 'FULL',
            shiftDate: toDateOnly(today),
            cashBf: 0,
            mpesaBf: 0
        };
    }

    const previousDateValue = previousShift.shift_date || previousShift.created_at || today;
    const nextDate = new Date(previousDateValue);
    const currentType = previousShift.shift_type || (shiftSystem === 2 ? 'DAY' : 'FULL');

    if (shiftSystem === 1) {
        nextDate.setDate(nextDate.getDate() + 1);
        return {
            shiftType: 'FULL',
            shiftDate: toDateOnly(nextDate),
            ...carryForward
        };
    }

    if (currentType === 'DAY') {
        return {
            shiftType: 'NIGHT',
            shiftDate: toDateOnly(nextDate),
            ...carryForward
        };
    }

    nextDate.setDate(nextDate.getDate() + 1);
    return {
        shiftType: 'DAY',
        shiftDate: toDateOnly(nextDate),
        ...carryForward
    };
}

export function annotateShiftsForDisplay(shifts = [], configuredShiftSystem = DEFAULT_SHIFT_SYSTEM) {
    const shiftSystem = normalizeShiftSystem(configuredShiftSystem);
    const dateCounters = new Map();
    const getShiftTypeRank = (shiftType) => {
        const normalized = String(shiftType || '').trim().toUpperCase();
        if (normalized === 'NIGHT') return 2;
        if (normalized === 'DAY') return 1;
        if (normalized === 'FULL') return 1;
        return 0;
    };

    const chronological = [...(shifts || [])].sort(
        (left, right) => new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime()
    );

    const annotated = chronological.map((shift) => {
        const shiftDate = shift.shift_date || toDateOnly(shift.created_at || new Date());
        const existingCount = dateCounters.get(shiftDate) || 0;
        const computedShiftType = shiftSystem === 1
            ? 'FULL'
            : existingCount % 2 === 0
                ? 'DAY'
                : 'NIGHT';

        dateCounters.set(shiftDate, existingCount + 1);

        return {
            ...shift,
            shift_date: shiftDate,
            shift_type: shift.shift_type || computedShiftType,
            shiftLabel: shift.shift_type || computedShiftType
        };
    });

    return annotated.sort(
        (left, right) => {
            const dateDiff = new Date(`${right.shift_date || toDateOnly(right.created_at || new Date())}T00:00:00Z`).getTime()
                - new Date(`${left.shift_date || toDateOnly(left.created_at || new Date())}T00:00:00Z`).getTime();
            if (dateDiff !== 0) return dateDiff;

            const shiftTypeDiff = getShiftTypeRank(right.shift_type || right.shiftLabel) - getShiftTypeRank(left.shift_type || left.shiftLabel);
            if (shiftTypeDiff !== 0) return shiftTypeDiff;

            return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        }
    );
}

export function validateShiftCloseInput({ currentShift, inventoryRows, finance }) {
    const errors = [];

    if (!currentShift?.id) errors.push('No active shift was found.');
    if (!inventoryRows?.length) errors.push('No inventory rows are available for this shift.');

    (inventoryRows || []).forEach((row) => {
        if (!row.hasClosingEntry) {
            errors.push(`Enter a closing stock for ${row.name || 'an item'} before closing the shift.`);
        }
        if (toNumber(row.closingQty) < 0) {
            errors.push(`Closing stock is missing for ${row.name || 'an item'}.`);
        }
    });

    if (toNumber(finance?.mpesaOpening) < 0) errors.push('M-Pesa opening balance is required.');
    if (toNumber(finance?.mpesaClosing) < 0) errors.push('M-Pesa closing balance is required.');
    if (toNumber(finance?.cashAtHand) < 0) errors.push('Cash at hand is required.');
    if (toNumber(finance?.totalSales) < 0) errors.push('Total sales must be available before closing.');

    return errors;
}
