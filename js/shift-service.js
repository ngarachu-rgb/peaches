import {
    calculateAccountedIncome,
    calculateMpesaIncome,
    calculateSoldQty,
    calculateVariance,
    getNextShiftSeed,
    validateShiftCloseInput
} from './calculations.js';

const reverseDispatchInFlightKeys = new Set();
const REVERSE_DISPATCH_GUARD_MS = 8000;

function getReverseDispatchKey(shiftId, productId, qty) {
    return `${shiftId}:${productId}:${toNumber(qty)}`;
}

function getRecentReverseDispatches() {
    try {
        const raw = sessionStorage.getItem('recentReverseDispatches');
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function setRecentReverseDispatches(entries) {
    try {
        sessionStorage.setItem('recentReverseDispatches', JSON.stringify(entries));
    } catch {
        // Ignore storage issues; in-memory guard still helps.
    }
}

function markRecentReverseDispatch(key) {
    const entries = getRecentReverseDispatches();
    entries[key] = Date.now();
    setRecentReverseDispatches(entries);
}

function wasRecentlyPosted(key) {
    const entries = getRecentReverseDispatches();
    const postedAt = Number(entries[key] || 0);
    if (!postedAt) {
        return false;
    }

    if ((Date.now() - postedAt) > REVERSE_DISPATCH_GUARD_MS) {
        delete entries[key];
        setRecentReverseDispatches(entries);
        return false;
    }

    return true;
}

function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

function toDateOnly(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().split('T')[0];
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

function usesStoreStockDeduction(row) {
    const saleMode = String(row?.saleMode || '').trim().toLowerCase();
    return saleMode === 'full' || saleMode === 'direct';
}

function getSellableUnitsForMaterial(material) {
    if (!material) return 0;

    const stockLevel = toNumber(material.stock_level ?? material.current_stock);
    const conversionFactor = Math.max(toNumber(material.conversion_factor), 1);
    const buyUnit = String(material.buy_unit || '').trim().toLowerCase();
    const storeUnit = String(material.store_unit || '').trim().toLowerCase();

    if (!buyUnit || !storeUnit || buyUnit === storeUnit) {
        return stockLevel;
    }

    return stockLevel / conversionFactor;
}

function validateDirectSalesCloseInput({ currentShift, inventoryRows, finance }) {
    const errors = [];

    if (!currentShift?.id) errors.push('No active shift was found.');

    (inventoryRows || []).forEach((row) => {
        if (!row.hasClosingEntry) {
            errors.push(`Enter a balance quantity for ${row.name || 'an item'} before closing the shift.`);
        }
        if (toNumber(row.soldQty) < 0) {
            errors.push(`Sold quantity is invalid for ${row.name || 'an item'}.`);
        }
    });

    if (toNumber(finance?.mpesaOpening) < 0) errors.push('M-Pesa opening balance is required.');
    if (toNumber(finance?.mpesaClosing) < 0) errors.push('M-Pesa closing balance is required.');
    if (toNumber(finance?.cashAtHand) < 0) errors.push('Cash at hand is required.');
    if (toNumber(finance?.totalSales) < 0) errors.push('Total sales must be available before closing.');

    return errors;
}

async function buildDirectSalesDeductionPlan(context, repositories, inventoryRows) {
    const [recipesResult, rawMaterialsResult] = await Promise.all([
        repositories.getRecipes(context),
        repositories.getRawMaterials(context)
    ]);

    if (recipesResult.error) throw recipesResult.error;
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;

    const recipes = recipesResult.data || [];
    const rawMaterials = rawMaterialsResult.data || [];
    const deductionPlan = new Map();

    const resolveMaterial = (materialName) => rawMaterials.find((material) => entityNamesMatch(material.name, materialName)) || null;
    const appendDeduction = (material, qty) => {
        const key = normalizeEntityName(material.name);
        const existing = deductionPlan.get(key);
        deductionPlan.set(key, {
            materialName: material.name,
            storeUnit: material.store_unit || 'store unit',
            availableQty: toNumber(material.stock_level ?? material.current_stock),
            qty: toNumber(existing?.qty) + qty
        });
    };

    for (const row of inventoryRows) {
        const soldQty = toNumber(row.soldQty);
        if (soldQty <= 0) continue;

        // Measured direct-sales items (shots / glasses) are already deducted from store
        // when stock is issued into shift stock. Do not deduct them again at shift close.
        if (!usesStoreStockDeduction(row) || row.saleMode === 'measured' || isMeasuredRecipeProductName(row.name)) {
            continue;
        }

        const directMaterial = resolveMaterial(row.name);
        if (!directMaterial) {
            throw new Error(`No direct stock item or recipe rows were found for ${stripEntityCodePrefix(row.name)}.`);
        }

        appendDeduction(directMaterial, soldQty * Math.max(toNumber(directMaterial.conversion_factor), 1));
    }

    for (const deduction of deductionPlan.values()) {
        if (deduction.qty > deduction.availableQty) {
            throw new Error(
                `Insufficient store stock for ${deduction.materialName}. ` +
                `Available: ${deduction.availableQty} ${deduction.storeUnit}. ` +
                `Needed: ${deduction.qty} ${deduction.storeUnit}.`
            );
        }
    }

    return deductionPlan;
}

function calculateDirectSalesAvailabilityForProduct(product, rawMaterials = [], recipes = []) {
    const matchingRecipes = (recipes || []).filter((recipe) => entityNamesMatch(recipe.finished_item_name, product.name));
    if (matchingRecipes.length && isMeasuredRecipeProductName(product.name)) {
        let availableUnits = Number.POSITIVE_INFINITY;

        for (const recipe of matchingRecipes) {
            const material = (rawMaterials || []).find((row) => entityNamesMatch(row.name, recipe.material_name));
            const qtyPerUnit = toNumber(recipe.qty_per_unit);
            if (!material || qtyPerUnit <= 0) {
                return 0;
            }

            const stockLevel = toNumber(material.stock_level ?? material.current_stock);
            availableUnits = Math.min(availableUnits, Math.floor(stockLevel / qtyPerUnit));
        }

        return Number.isFinite(availableUnits) ? availableUnits : 0;
    }

    const directMaterial = (rawMaterials || []).find((row) => entityNamesMatch(row.name, product.name));
    return getSellableUnitsForMaterial(directMaterial);
}

async function buildDirectSalesOpeningRows(context, repositories, shiftId, products = [], previousShiftInventory = []) {
    const [recipesResult, rawMaterialsResult] = await Promise.all([
        repositories.getRecipes(context),
        repositories.getRawMaterials(context)
    ]);

    if (recipesResult.error) throw recipesResult.error;
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;

    const recipes = recipesResult.data || [];
    const rawMaterials = rawMaterialsResult.data || [];
    const previousByProduct = new Map(
        (previousShiftInventory || []).map((row) => [row.product_id, toNumber(row.close_qty ?? row.bbf)])
    );

    return (products || []).map((product) => ({
        shift_id: shiftId,
        product_id: product.id,
        bbf: isMeasuredRecipeProductName(product.name)
            ? (previousByProduct.get(product.id) || 0)
            : calculateDirectSalesAvailabilityForProduct(product, rawMaterials, recipes),
        added_today: 0,
        close_qty: 0,
        sold_qty: 0
    }));
}

async function buildRestaurantKeyStoreOpeningRows(context, repositories, shiftId, previousShiftId = '') {
    const rawMaterialsResult = await repositories.getRawMaterials(context);
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;

    const keyMaterials = (rawMaterialsResult.data || []).filter((material) => material?.is_key_shift_item === true);
    if (!keyMaterials.length) return [];

    let previousRows = [];
    if (previousShiftId) {
        const previousRowsResult = await repositories.getShiftStoreChecks(context, previousShiftId);
        if (previousRowsResult.error) throw previousRowsResult.error;
        previousRows = previousRowsResult.data || [];
    }

    const previousByMaterialId = new Map(previousRows.map((row) => [String(row.material_id || ''), row]));

    return keyMaterials.map((material) => {
        const previousRow = previousByMaterialId.get(String(material.id || ''));
        const openingQty = previousRow && previousRow.actual_closing_qty !== null && previousRow.actual_closing_qty !== undefined
            ? toNumber(previousRow.actual_closing_qty)
            : toNumber(material.stock_level ?? material.current_stock);

        return {
            shift_id: shiftId,
            material_id: material.id,
            material_name_snapshot: material.name,
            store_unit_snapshot: material.store_unit || '',
            opening_qty: openingQty,
            actual_closing_qty: null,
            expected_qty: null,
            variance_qty: null,
            notes: '',
            updated_at: new Date().toISOString()
        };
    });
}

async function ensureRestaurantKeyStoreChecks(context, repositories, shift, previousShiftId = '') {
    if (context.operatingMode === 'DIRECT_SALES' || !shift?.id) {
        return [];
    }

    const rawMaterialsResult = await repositories.getRawMaterials(context);
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;
    const keyMaterials = (rawMaterialsResult.data || []).filter((material) => material?.is_key_shift_item === true);
    if (!keyMaterials.length) return [];

    const existingResult = await repositories.getShiftStoreChecks(context, shift.id);
    if (existingResult.error) throw existingResult.error;
    const existingRows = existingResult.data || [];
    const existingByMaterialId = new Map(existingRows.map((row) => [String(row.material_id || ''), row]));
    const missingMaterials = keyMaterials.filter((material) => !existingByMaterialId.has(String(material.id || '')));
    if (!missingMaterials.length) {
        return existingRows;
    }

    const openingRows = await buildRestaurantKeyStoreOpeningRows(context, repositories, shift.id, previousShiftId);
    const missingRows = openingRows.filter((row) => !existingByMaterialId.has(String(row.material_id || '')));
    if (!missingRows.length) {
        return existingRows;
    }

    const upsertResult = await repositories.upsertShiftStoreChecks(context, missingRows);
    if (upsertResult.error) throw upsertResult.error;

    const refreshedResult = await repositories.getShiftStoreChecks(context, shift.id);
    if (refreshedResult.error) throw refreshedResult.error;
    return refreshedResult.data || [];
}

async function closeDirectSalesShift(context, repositories, currentShift, payload) {
    const inventoryRows = (payload.inventoryRows || []).map((row) => ({
        ...row,
        soldQty: toNumber(row.soldQty)
    }));

    const mpesaIncome = calculateMpesaIncome(
        payload.finance.mpesaOpening,
        payload.finance.mpesaClosing,
        payload.finance.mpesaWithdraw
    );

    const accountedIncome = calculateAccountedIncome({
        cashAtHand: payload.finance.cashAtHand,
        mpesaIncome,
        totalExpenses: payload.finance.totalExpenses,
        debtGiven: payload.finance.debtGiven,
        prevDebtsPaid: payload.finance.prevDebtsPaid
    });

    const finance = {
        ...payload.finance,
        mpesaIncome,
        accountedIncome,
        variance: calculateVariance(payload.finance.totalSales, accountedIncome)
    };

    const validationErrors = validateDirectSalesCloseInput({
        currentShift,
        inventoryRows,
        finance
    });

    if (validationErrors.length > 0) {
        throw new Error(validationErrors.join('\n'));
    }

    const deductionPlan = await buildDirectSalesDeductionPlan(context, repositories, inventoryRows);
    const timestamp = new Date().toISOString();
    let closedShift = null;
    let nextShift = null;
    const appliedDeductions = [];

    try {
        for (const expenseLine of payload.expenseLines || []) {
            const { error } = await repositories.insertExpense(context, {
                shiftId: currentShift.id,
                amount: expenseLine.amount,
                description: expenseLine.description,
                qty: expenseLine.qty,
                unitCost: expenseLine.unitCost,
                notes: expenseLine.notes,
                createdAt: timestamp,
                createdBy: payload.closedBy
            });
            if (error) throw error;
        }

        for (const debtLine of payload.debtGivenLines || []) {
            const { error } = await repositories.insertDebt(context, {
                shiftId: currentShift.id,
                amount: debtLine.amount,
                transactionType: 'given',
                clientName: debtLine.clientName,
                phone: debtLine.phone,
                notes: debtLine.notes,
                createdAt: timestamp,
                createdBy: payload.closedBy
            });
            if (error) throw error;
        }

        for (const debtLine of payload.debtPaidLines || []) {
            const { error } = await repositories.insertDebt(context, {
                shiftId: currentShift.id,
                amount: debtLine.amount,
                transactionType: 'paid',
                clientName: debtLine.clientName,
                phone: debtLine.phone,
                notes: debtLine.notes,
                createdAt: timestamp,
                createdBy: payload.closedBy
            });
            if (error) throw error;
        }

        for (const deduction of deductionPlan.values()) {
            const deductionResult = await repositories.adjustRawMaterialStoreStock(
                context,
                deduction.materialName,
                -deduction.qty
            );
            if (deductionResult.error) throw deductionResult.error;

            appliedDeductions.push({
                materialName: deduction.materialName,
                qty: deduction.qty
            });
        }

        const closingRows = inventoryRows.map((row) => {
            const nextRow = {
                shift_id: currentShift.id,
                product_id: row.productId,
                bbf: row.openingQty,
                added_today: row.producedQty,
                close_qty: row.closingQty,
                sold_qty: row.soldQty,
                unit_price: toNumber(row.unitPrice),
                line_total: toNumber(row.lineTotal)
            };

            if (row.shiftRowId) nextRow.id = row.shiftRowId;
            return nextRow;
        });

        const { error: inventoryError } = await repositories.upsertShiftInventoryRows(context, closingRows);
        if (inventoryError) throw inventoryError;

        const closeResult = await repositories.updateShift(currentShift.id, {
            total_sales: finance.totalSales,
            mpesa_float: finance.mpesaOpening,
            mpesa_closing: finance.mpesaClosing,
            mpesa_withdrawals: finance.mpesaWithdraw,
            mpesa_income: finance.mpesaIncome,
            cash_at_hand: finance.cashAtHand,
            total_expenses: finance.totalExpenses,
            total_debts: finance.debtGiven,
            debts_collected: finance.prevDebtsPaid,
            variance: finance.variance,
            closed_by: payload.closedBy,
            reconciliation_notes: finance.notes || ''
        });
        if (closeResult.error) throw closeResult.error;
        closedShift = closeResult.data;

        const nextSeed = getNextShiftSeed(closedShift, context.shiftSystem);
        const nextShiftResult = await repositories.createShift(context, {
            created_at: new Date(`${nextSeed.shiftDate}T00:00:00Z`).toISOString(),
            shift_date: nextSeed.shiftDate,
            shift_type: nextSeed.shiftType,
            cash_at_hand: finance.cashAtHand,
            mpesa_float: finance.mpesaClosing,
            mpesa_closing: 0,
            mpesa_withdrawals: 0,
            mpesa_income: 0,
            total_sales: null,
            total_expenses: 0,
            total_debts: 0,
            debts_collected: 0,
            variance: null,
            closed_by: null,
            reconciliation_notes: ''
        });
        if (nextShiftResult.error) throw nextShiftResult.error;
        nextShift = nextShiftResult.data;

        const { data: nextShiftProducts, error: nextProductsError } = await repositories.getProducts(context);
        if (nextProductsError) throw nextProductsError;

        const closingRowsByProduct = inventoryRows.map((row) => ({
            product_id: row.productId,
            close_qty: row.closingQty,
            bbf: row.openingQty
        }));

        const nextOpeningRows = await buildDirectSalesOpeningRows(
            context,
            repositories,
            nextShift.id,
            nextShiftProducts || [],
            closingRowsByProduct
        );

        const { error: nextInventoryError } = await repositories.upsertShiftInventoryRows(context, nextOpeningRows);
        if (nextInventoryError) throw nextInventoryError;

        return {
            closedShift,
            nextShift,
            finance
        };
    } catch (error) {
        for (const deduction of appliedDeductions.reverse()) {
            await repositories.adjustRawMaterialStoreStock(context, deduction.materialName, deduction.qty);
        }

        if (nextShift?.id) {
            await repositories.deleteShiftInventoryByShift(context, nextShift.id);
            await repositories.deleteShift(nextShift.id);
        }

        if (closedShift?.id) {
            await repositories.updateShift(currentShift.id, {
                total_sales: currentShift?.total_sales ?? null,
                mpesa_float: currentShift?.mpesa_float ?? 0,
                mpesa_closing: currentShift?.mpesa_closing ?? 0,
                mpesa_withdrawals: currentShift?.mpesa_withdrawals ?? 0,
                mpesa_income: currentShift?.mpesa_income ?? 0,
                cash_at_hand: currentShift?.cash_at_hand ?? 0,
                total_expenses: currentShift?.total_expenses ?? 0,
                total_debts: currentShift?.total_debts ?? 0,
                debts_collected: currentShift?.debts_collected ?? 0,
                variance: currentShift?.variance ?? null,
                closed_by: currentShift?.closed_by ?? null
            });
        }

        throw error;
    }
}

function buildOpeningRows(context, shiftId, products, previousShiftInventory = []) {
    const previousByProduct = new Map(
        previousShiftInventory.map((row) => [
            row.product_id,
            toNumber(row.close_qty ?? row.bbf)
        ])
    );

    return (products || []).map((product) => ({
        shift_id: shiftId,
        product_id: product.id,
        bbf: previousByProduct.get(product.id) || 0,
        added_today: 0,
        close_qty: 0,
        sold_qty: 0
    }));
}

export async function ensureActiveShift(context, repositories) {
    const { data: openShifts, error: openShiftError } = await repositories.getOpenShifts(context);
    if (openShiftError) throw openShiftError;

    if ((openShifts || []).length > 1) {
        const shiftIds = openShifts.map((shift) => shift.id).join(', ');
        throw new Error(`Multiple open shifts were found. Resolve them before continuing. Open shift ids: ${shiftIds}`);
    }

    if (openShifts?.[0]) {
        await ensureRestaurantKeyStoreChecks(context, repositories, openShifts[0]);
        return openShifts[0];
    }

    const { data: latestClosedShift, error: latestClosedError } = await repositories.getLatestClosedShift(context);
    if (latestClosedError) throw latestClosedError;

    let previousInventory = [];
    if (latestClosedShift?.id) {
        const { data, error } = await repositories.getShiftInventory(context, latestClosedShift.id);
        if (error) throw error;
        previousInventory = data || [];
    }

    const { data: products, error: productsError } = await repositories.getProducts(context);
    if (productsError) throw productsError;

    const nextSeed = getNextShiftSeed(latestClosedShift, context.shiftSystem);
    const { data: newShift, error: createError } = await repositories.createShift(context, {
        created_at: new Date(`${nextSeed.shiftDate}T00:00:00Z`).toISOString(),
        shift_date: nextSeed.shiftDate,
        shift_type: nextSeed.shiftType,
        cash_at_hand: nextSeed.cashBf,
        mpesa_float: nextSeed.mpesaBf,
        mpesa_closing: 0,
        mpesa_withdrawals: 0,
        mpesa_income: 0,
        total_sales: null,
        total_expenses: 0,
        total_debts: 0,
        debts_collected: 0,
        variance: null,
        closed_by: null
    });
    if (createError) throw createError;

    const openingRows = context.operatingMode === 'DIRECT_SALES'
        ? await buildDirectSalesOpeningRows(context, repositories, newShift.id, products, previousInventory)
        : buildOpeningRows(context, newShift.id, products, previousInventory);
    if (openingRows.length > 0) {
        const { error: inventoryError } = await repositories.upsertShiftInventoryRows(context, openingRows);
        if (inventoryError) throw inventoryError;
    }

    await ensureRestaurantKeyStoreChecks(context, repositories, newShift, latestClosedShift?.id || '');

    return newShift;
}

export async function recordReverseDispatch(context, repositories, shiftId, productId, qty) {
    const dispatchKey = getReverseDispatchKey(shiftId, productId, qty);

    if (reverseDispatchInFlightKeys.has(dispatchKey)) {
        throw new Error('This production post is already running. Please wait.');
    }

    if (wasRecentlyPosted(dispatchKey)) {
        throw new Error('This production quantity was just posted. Wait a moment before retrying to avoid duplicates.');
    }

    reverseDispatchInFlightKeys.add(dispatchKey);

    try {
        await applyReverseDispatchDelta(context, repositories, shiftId, productId, qty);
        markRecentReverseDispatch(dispatchKey);
    } finally {
        reverseDispatchInFlightKeys.delete(dispatchKey);
    }
}

async function applyReverseDispatchDelta(context, repositories, shiftId, productId, qty) {
    const numericQty = toNumber(qty);
    if (numericQty <= 0) {
        throw new Error('Production quantity must be greater than 0.');
    }

    const [
        { data: existingRow, error: existingError },
        productsResult,
        recipesResult,
        rawMaterialsResult
    ] = await Promise.all([
        repositories.getShiftInventoryRow(context, shiftId, productId),
        repositories.getProducts(context),
        repositories.getRecipes(context),
        repositories.getRawMaterials(context)
    ]);

    if (existingError) throw existingError;
    if (productsResult.error) throw productsResult.error;
    if (recipesResult.error) throw recipesResult.error;
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;

    const product = (productsResult.data || []).find((item) => String(item.id) === String(productId));
    if (!product) throw new Error('Selected finished product was not found.');

    const matchingRecipes = (recipesResult.data || []).filter((recipe) =>
        String(recipe.finished_item_name || '').trim().toLowerCase() === String(product.name || '').trim().toLowerCase()
    );
    if (!matchingRecipes.length) {
        throw new Error(`No recipe matrix rows were found for ${product.name}.`);
    }

    const rawMaterialMap = new Map(
        (rawMaterialsResult.data || []).map((material) => [
            String(material.name || '').trim().toLowerCase(),
            material
        ])
    );

    const deductionPlan = new Map();
    for (const recipe of matchingRecipes) {
        const materialName = String(recipe.material_name || '').trim();
        const material = rawMaterialMap.get(materialName.toLowerCase());
        if (!material) {
            throw new Error(`Recipe material "${materialName}" was not found in store stock.`);
        }

        const qtyPerUnit = toNumber(recipe.qty_per_unit);
        if (qtyPerUnit <= 0) {
            throw new Error(`Recipe quantity for "${materialName}" must be greater than 0 store units per item.`);
        }

        const storeQtyToDeduct = numericQty * qtyPerUnit;
        const key = String(material.name || '').trim().toLowerCase();
        const existingPlan = deductionPlan.get(key);

        deductionPlan.set(key, {
            materialName: material.name,
            storeUnit: material.store_unit || 'store unit',
            availableQty: toNumber(material.stock_level ?? material.current_stock),
            qty: toNumber(existingPlan?.qty) + storeQtyToDeduct
        });
    }

    for (const deduction of deductionPlan.values()) {
        if (deduction.qty > deduction.availableQty) {
            throw new Error(
                `Insufficient store stock for ${deduction.materialName}. ` +
                `Available: ${deduction.availableQty} ${deduction.storeUnit}. ` +
                `Needed: ${deduction.qty} ${deduction.storeUnit}.`
            );
        }
    }

    const appliedDeductions = [];
    try {
        for (const deduction of deductionPlan.values()) {
            const deductionResult = await repositories.adjustRawMaterialStoreStock(
                context,
                deduction.materialName,
                -deduction.qty
            );
            if (deductionResult.error) throw deductionResult.error;

            appliedDeductions.push({
                materialName: deduction.materialName,
                qty: deduction.qty
            });
        }

        const rowPayload = {
            shift_id: shiftId,
            product_id: productId,
            bbf: toNumber(existingRow?.bbf),
            added_today: toNumber(existingRow?.added_today) + numericQty,
            close_qty: toNumber(existingRow?.close_qty),
            sold_qty: toNumber(existingRow?.sold_qty)
        };

        if (existingRow?.id) {
            rowPayload.id = existingRow.id;
        }

        const { error: upsertError } = await repositories.upsertShiftInventoryRows(context, [rowPayload]);
        if (upsertError) throw upsertError;
    } catch (error) {
        for (const deduction of appliedDeductions.reverse()) {
            await repositories.adjustRawMaterialStoreStock(context, deduction.materialName, deduction.qty);
        }
        throw error;
    }
}

export async function adjustReverseDispatch(context, repositories, shiftId, productId, nextAddedQty) {
    const numericNextAddedQty = toNumber(nextAddedQty);
    if (numericNextAddedQty < 0) {
        throw new Error('Adjusted production quantity cannot be negative.');
    }

    const [
        { data: existingRow, error: existingError },
        productsResult,
        recipesResult,
        rawMaterialsResult
    ] = await Promise.all([
        repositories.getShiftInventoryRow(context, shiftId, productId),
        repositories.getProducts(context),
        repositories.getRecipes(context),
        repositories.getRawMaterials(context)
    ]);

    if (existingError) throw existingError;
    if (productsResult.error) throw productsResult.error;
    if (recipesResult.error) throw recipesResult.error;
    if (rawMaterialsResult.error) throw rawMaterialsResult.error;

    if (!existingRow?.id) {
        throw new Error('No existing production record was found for the selected item.');
    }

    const currentAddedQty = toNumber(existingRow.added_today);
    if (numericNextAddedQty === currentAddedQty) {
        return { updatedQty: currentAddedQty };
    }

    const product = (productsResult.data || []).find((item) => String(item.id) === String(productId));
    if (!product) throw new Error('Selected finished product was not found.');

    const matchingRecipes = (recipesResult.data || []).filter((recipe) =>
        String(recipe.finished_item_name || '').trim().toLowerCase() === String(product.name || '').trim().toLowerCase()
    );
    if (!matchingRecipes.length) {
        throw new Error(`No recipe matrix rows were found for ${product.name}.`);
    }

    const rawMaterialMap = new Map(
        (rawMaterialsResult.data || []).map((material) => [
            String(material.name || '').trim().toLowerCase(),
            material
        ])
    );

    const deltaQty = numericNextAddedQty - currentAddedQty;

    if (deltaQty > 0) {
        await applyReverseDispatchDelta(context, repositories, shiftId, productId, deltaQty);
        return { updatedQty: numericNextAddedQty };
    }

    const restoreQty = Math.abs(deltaQty);
    const restorationPlan = [];
    for (const recipe of matchingRecipes) {
        const materialName = String(recipe.material_name || '').trim();
        const material = rawMaterialMap.get(materialName.toLowerCase());
        if (!material) {
            throw new Error(`Recipe material "${materialName}" was not found in store stock.`);
        }

        const qtyPerUnit = toNumber(recipe.qty_per_unit);
        if (qtyPerUnit <= 0) {
            throw new Error(`Recipe quantity for "${materialName}" must be greater than 0 store units per item.`);
        }

        restorationPlan.push({
            materialName: material.name,
            qty: restoreQty * qtyPerUnit
        });
    }

    for (const restoration of restorationPlan) {
        const restoreResult = await repositories.adjustRawMaterialStoreStock(
            context,
            restoration.materialName,
            restoration.qty
        );
        if (restoreResult.error) throw restoreResult.error;
    }

    try {
        const { error: upsertError } = await repositories.upsertShiftInventoryRows(context, [{
            id: existingRow.id,
            shift_id: shiftId,
            product_id: productId,
            bbf: toNumber(existingRow.bbf),
            added_today: numericNextAddedQty,
            close_qty: toNumber(existingRow.close_qty),
            sold_qty: toNumber(existingRow.sold_qty)
        }]);
        if (upsertError) throw upsertError;
    } catch (error) {
        for (const restoration of restorationPlan.reverse()) {
            await repositories.adjustRawMaterialStoreStock(
                context,
                restoration.materialName,
                -restoration.qty
            );
        }
        throw error;
    }

    return { updatedQty: numericNextAddedQty };
}

export async function closeShiftWithCarryForward(context, repositories, currentShift, payload) {
    const { data: openShifts, error: openShiftError } = await repositories.getOpenShifts(context);
    if (openShiftError) throw openShiftError;

    const conflictingOpenShifts = (openShifts || []).filter((shift) => String(shift.id) !== String(currentShift?.id));
    if (conflictingOpenShifts.length > 0) {
        const shiftIds = conflictingOpenShifts.map((shift) => shift.id).join(', ');
        throw new Error(`Another open shift exists. Resolve it before closing this shift. Open shift ids: ${shiftIds}`);
    }

    if (context.operatingMode === 'DIRECT_SALES') {
        return closeDirectSalesShift(context, repositories, currentShift, payload);
    }

    const inventoryRows = (payload.inventoryRows || []).map((row) => {
        const soldQty = usesStoreStockDeduction(row)
            ? Math.max(
                0,
                toNumber(row.openingQty) +
                toNumber(row.producedQty) +
                toNumber(row.receivedQty) -
                toNumber(row.transferredOutQty) +
                toNumber(row.transferredInQty) -
                toNumber(row.closingQty)
            )
            : calculateSoldQty({
                openingQty: row.openingQty,
                producedQty: row.producedQty,
                receivedQty: row.receivedQty,
                closingQty: row.closingQty,
                transferredOutQty: row.transferredOutQty,
                transferredInQty: row.transferredInQty
            });

        return {
            ...row,
            soldQty
        };
    });

    const mpesaIncome = calculateMpesaIncome(
        payload.finance.mpesaOpening,
        payload.finance.mpesaClosing,
        payload.finance.mpesaWithdraw
    );

    const accountedIncome = calculateAccountedIncome({
        cashAtHand: payload.finance.cashAtHand,
        mpesaIncome,
        totalExpenses: payload.finance.totalExpenses,
        debtGiven: payload.finance.debtGiven,
        prevDebtsPaid: payload.finance.prevDebtsPaid
    });

    const finance = {
        ...payload.finance,
        mpesaIncome,
        accountedIncome,
        variance: calculateVariance(payload.finance.totalSales, accountedIncome)
    };
    const keyStoreChecks = context.operatingMode === 'DIRECT_SALES'
        ? []
        : (payload.keyStoreChecks || []);

    const keyStoreCheckErrors = keyStoreChecks
        .filter((row) => !row.hasActualEntry)
        .map((row) => `Enter key store closing balance for ${stripEntityCodePrefix(row.materialName || 'an item')} before closing the shift.`);

    const validationErrors = validateShiftCloseInput({
        currentShift,
        inventoryRows,
        finance
    });

    if (validationErrors.length > 0 || keyStoreCheckErrors.length > 0) {
        throw new Error([...validationErrors, ...keyStoreCheckErrors].join('\n'));
    }

    const directStoreRows = inventoryRows.filter((row) => usesStoreStockDeduction(row));
    const deductionPlan = directStoreRows.length
        ? await buildDirectSalesDeductionPlan(context, repositories, directStoreRows)
        : new Map();
    const timestamp = new Date().toISOString();
    let closedShift = null;
    let nextShift = null;
    const appliedDeductions = [];

    try {
        for (const expenseLine of payload.expenseLines || []) {
            const { error } = await repositories.insertExpense(context, {
                shiftId: currentShift.id,
                amount: expenseLine.amount,
                description: expenseLine.description,
                qty: expenseLine.qty,
                unitCost: expenseLine.unitCost,
                notes: expenseLine.notes,
                createdAt: timestamp,
                createdBy: payload.closedBy
            });
            if (error) throw error;
        }

        for (const debtLine of payload.debtGivenLines || []) {
            const { error } = await repositories.insertDebt(context, {
                shiftId: currentShift.id,
                amount: debtLine.amount,
                transactionType: 'given',
                clientName: debtLine.clientName,
                phone: debtLine.phone,
                notes: debtLine.notes,
                createdAt: timestamp,
                createdBy: payload.closedBy
            });
            if (error) throw error;
        }

        for (const debtLine of payload.debtPaidLines || []) {
            const { error } = await repositories.insertDebt(context, {
                shiftId: currentShift.id,
                amount: debtLine.amount,
                transactionType: 'paid',
                clientName: debtLine.clientName,
                phone: debtLine.phone,
                notes: debtLine.notes,
                createdAt: timestamp,
                createdBy: payload.closedBy
            });
            if (error) throw error;
        }

        for (const deduction of deductionPlan.values()) {
            const deductionResult = await repositories.adjustRawMaterialStoreStock(
                context,
                deduction.materialName,
                -deduction.qty
            );
            if (deductionResult.error) throw deductionResult.error;

            appliedDeductions.push({
                materialName: deduction.materialName,
                qty: deduction.qty
            });
        }

        const closingRows = inventoryRows.map((row) => {
            const nextRow = {
                shift_id: currentShift.id,
                product_id: row.productId,
                bbf: row.openingQty,
                added_today: row.producedQty,
                close_qty: row.closingQty,
                sold_qty: row.soldQty,
                unit_price: toNumber(row.unitPrice),
                line_total: toNumber(row.lineTotal)
            };

            if (row.shiftRowId) nextRow.id = row.shiftRowId;
            return nextRow;
        });

        const { error: inventoryError } = await repositories.upsertShiftInventoryRows(context, closingRows);
        if (inventoryError) throw inventoryError;

        if (keyStoreChecks.length > 0) {
            const checkRows = keyStoreChecks.map((row) => ({
                id: row.id || undefined,
                shift_id: currentShift.id,
                material_id: row.materialId,
                material_name_snapshot: row.materialName,
                store_unit_snapshot: row.unit || '',
                opening_qty: row.openingQty,
                actual_closing_qty: row.actualClosingQty,
                expected_qty: row.expectedQty,
                variance_qty: row.varianceQty,
                notes: row.notes || '',
                updated_at: timestamp
            }));
            const checkUpsertResult = await repositories.upsertShiftStoreChecks(context, checkRows);
            if (checkUpsertResult.error) throw checkUpsertResult.error;
        }

        const closeResult = await repositories.updateShift(currentShift.id, {
            total_sales: finance.totalSales,
            mpesa_float: finance.mpesaOpening,
            mpesa_closing: finance.mpesaClosing,
            mpesa_withdrawals: finance.mpesaWithdraw,
            mpesa_income: finance.mpesaIncome,
            cash_at_hand: finance.cashAtHand,
            total_expenses: finance.totalExpenses,
            total_debts: finance.debtGiven,
            debts_collected: finance.prevDebtsPaid,
            variance: finance.variance,
            closed_by: payload.closedBy,
            reconciliation_notes: finance.notes || ''
        });
        if (closeResult.error) throw closeResult.error;
        closedShift = closeResult.data;

        const nextSeed = getNextShiftSeed(closedShift, context.shiftSystem);
        const nextShiftResult = await repositories.createShift(context, {
            created_at: new Date(`${nextSeed.shiftDate}T00:00:00Z`).toISOString(),
            shift_date: nextSeed.shiftDate,
            shift_type: nextSeed.shiftType,
            cash_at_hand: finance.cashAtHand,
            mpesa_float: finance.mpesaClosing,
            mpesa_closing: 0,
            mpesa_withdrawals: 0,
            mpesa_income: 0,
            total_sales: null,
            total_expenses: 0,
            total_debts: 0,
            debts_collected: 0,
            variance: null,
            closed_by: null,
            reconciliation_notes: ''
        });
        if (nextShiftResult.error) throw nextShiftResult.error;
        nextShift = nextShiftResult.data;

        const nextOpeningRows = inventoryRows.map((row) => ({
            shift_id: nextShift.id,
            product_id: row.productId,
            bbf: row.closingQty,
            added_today: 0,
            close_qty: 0,
            sold_qty: 0
        }));

        const { error: nextInventoryError } = await repositories.upsertShiftInventoryRows(context, nextOpeningRows);
        if (nextInventoryError) throw nextInventoryError;

        if (keyStoreChecks.length > 0) {
            const nextCheckRows = keyStoreChecks.map((row) => ({
                shift_id: nextShift.id,
                material_id: row.materialId,
                material_name_snapshot: row.materialName,
                store_unit_snapshot: row.unit || '',
                opening_qty: toNumber(row.actualClosingQty),
                actual_closing_qty: null,
                expected_qty: null,
                variance_qty: null,
                notes: '',
                updated_at: timestamp
            }));
            const nextCheckUpsertResult = await repositories.upsertShiftStoreChecks(context, nextCheckRows);
            if (nextCheckUpsertResult.error) throw nextCheckUpsertResult.error;
        }

        return {
            closedShift,
            nextShift,
            finance
        };
    } catch (error) {
        for (const deduction of appliedDeductions.reverse()) {
            await repositories.adjustRawMaterialStoreStock(context, deduction.materialName, deduction.qty);
        }

        if (nextShift?.id) {
            await repositories.deleteShiftInventoryByShift(context, nextShift.id);
            await repositories.deleteShift(nextShift.id);
        }

        if (closedShift?.id) {
            await repositories.updateShift(currentShift.id, {
                total_sales: currentShift?.total_sales ?? null,
                mpesa_float: currentShift?.mpesa_float ?? 0,
                mpesa_closing: currentShift?.mpesa_closing ?? 0,
                mpesa_withdrawals: currentShift?.mpesa_withdrawals ?? 0,
                mpesa_income: currentShift?.mpesa_income ?? 0,
                cash_at_hand: currentShift?.cash_at_hand ?? 0,
                total_expenses: currentShift?.total_expenses ?? 0,
                total_debts: currentShift?.total_debts ?? 0,
                debts_collected: currentShift?.debts_collected ?? 0,
                variance: currentShift?.variance ?? null,
                closed_by: currentShift?.closed_by ?? null
            });
        }

        throw error;
    }
}
