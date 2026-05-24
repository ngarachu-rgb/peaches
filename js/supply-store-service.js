function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

async function ensureSupplyStoreRow(repositories, context, branchId, supplyItem, latestUnitCost = 0) {
    const existing = await repositories.getSupplyStoreRowByBranch(context, branchId, supplyItem.id);
    if (existing.error) {
        throw existing.error;
    }
    if (existing.data?.id) {
        return existing.data;
    }

    const created = await repositories.createSupplyStoreRowInBranch(context, branchId, {
        supplyItemId: supplyItem.id,
        itemName: supplyItem.name,
        category: supplyItem.category || 'General Supplies',
        buyUnit: supplyItem.buy_unit || '',
        stockLevel: 0,
        currentStock: 0,
        reorderLevel: supplyItem.reorder_level ?? null,
        latestUnitCost
    });
    if (created.error) {
        throw created.error;
    }

    return created.data;
}

export async function recordSupplyReceipt(context, repositories, payload) {
    const branchId = String(context?.branchId || '').trim();
    if (!context?.restaurantId || !branchId) {
        throw new Error('A branch scope is required before recording supplies.');
    }

    const supplyItem = payload?.supplyItem;
    if (!supplyItem?.id) {
        throw new Error('A supply item is required before recording supplies.');
    }

    const qtyReceived = toNumber(payload?.qtyReceived);
    const totalReceivedCost = toNumber(payload?.totalReceivedCost);
    const unitCost = qtyReceived > 0 ? totalReceivedCost / qtyReceived : 0;
    if (qtyReceived <= 0 || totalReceivedCost <= 0) {
        throw new Error('Supply receipt quantity and total cost must be greater than 0.');
    }

    await ensureSupplyStoreRow(repositories, context, branchId, supplyItem, unitCost);

    const receiptResult = await repositories.insertSupplyReceipt(context, {
        shiftId: payload.shiftId,
        supplyItemId: supplyItem.id,
        itemName: supplyItem.name,
        category: supplyItem.category || 'General Supplies',
        qtyReceived,
        buyUnit: supplyItem.buy_unit || payload.buyUnit || '',
        totalReceivedCost,
        unitCost,
        notes: payload.notes || '',
        receivedBy: payload.receivedBy || 'Staff'
    });
    if (receiptResult.error) {
        throw receiptResult.error;
    }

    const storeResult = await repositories.adjustSupplyStoreStockByBranch(context, branchId, supplyItem.id, qtyReceived, {
        itemName: supplyItem.name,
        category: supplyItem.category || 'General Supplies',
        buyUnit: supplyItem.buy_unit || payload.buyUnit || '',
        latestUnitCost: unitCost
    });
    if (storeResult.error) {
        if (receiptResult.data?.id) {
            await repositories.deleteSupplyReceipt?.(context, receiptResult.data.id);
        }
        throw storeResult.error;
    }

    return {
        data: {
            receipt: receiptResult.data,
            store: storeResult.data
        },
        error: null
    };
}

export async function issueSupplyStock(context, repositories, payload) {
    const branchId = String(context?.branchId || '').trim();
    if (!context?.restaurantId || !branchId) {
        throw new Error('A branch scope is required before issuing supplies.');
    }

    const supplyItem = payload?.supplyItem;
    if (!supplyItem?.id) {
        throw new Error('Select a supply item to issue.');
    }

    const qtyIssued = toNumber(payload?.qtyIssued);
    if (qtyIssued <= 0) {
        throw new Error('Supply issue quantity must be greater than 0.');
    }

    const stockResult = await repositories.adjustSupplyStoreStockByBranch(context, branchId, supplyItem.id, -qtyIssued, {
        itemName: supplyItem.name,
        category: supplyItem.category || 'General Supplies',
        buyUnit: supplyItem.buy_unit || ''
    });
    if (stockResult.error) {
        throw stockResult.error;
    }

    const issueResult = await repositories.insertSupplyIssue(context, {
        shiftId: payload.shiftId || null,
        supplyItemId: supplyItem.id,
        itemName: supplyItem.name,
        qtyIssued,
        buyUnit: supplyItem.buy_unit || '',
        issuedTo: payload.issuedTo || '',
        notes: payload.notes || '',
        createdBy: payload.createdBy || 'Staff'
    });
    if (issueResult.error) {
        await repositories.adjustSupplyStoreStockByBranch(context, branchId, supplyItem.id, qtyIssued, {
            itemName: supplyItem.name,
            category: supplyItem.category || 'General Supplies',
            buyUnit: supplyItem.buy_unit || ''
        });
        throw issueResult.error;
    }

    return {
        data: {
            issue: issueResult.data,
            store: stockResult.data
        },
        error: null
    };
}

export async function transferSupplyStock(context, repositories, payload) {
    const fromBranchId = String(payload?.fromBranchId || '').trim();
    const toBranchId = String(payload?.toBranchId || '').trim();
    const qty = toNumber(payload?.qty);
    const supplyItem = payload?.supplyItem;

    if (!context?.restaurantId) {
        throw new Error('A restaurant scope is required before transferring supplies.');
    }
    if (!fromBranchId || !toBranchId) {
        throw new Error('Select both source and destination branches for the supply transfer.');
    }
    if (fromBranchId === toBranchId) {
        throw new Error('Source and destination branches must be different.');
    }
    if (!supplyItem?.id) {
        throw new Error('Select a supply item to transfer.');
    }
    if (qty <= 0) {
        throw new Error('Supply transfer quantity must be greater than 0.');
    }

    const branchResult = await repositories.getBranches(context);
    if (branchResult.error) {
        throw branchResult.error;
    }
    const branchMap = new Map((branchResult.data || []).map((branch) => [String(branch.id), branch]));
    const fromBranch = branchMap.get(fromBranchId);
    const toBranch = branchMap.get(toBranchId);
    if (!fromBranch || !toBranch) {
        throw new Error('One or both selected branches were not found.');
    }
    if (fromBranch.is_active === false || toBranch.is_active === false) {
        throw new Error('Transfers are only allowed between active branches.');
    }

    await ensureSupplyStoreRow(repositories, context, toBranchId, supplyItem, toNumber(payload.latestUnitCost));

    const deductResult = await repositories.adjustSupplyStoreStockByBranch(context, fromBranchId, supplyItem.id, -qty, {
        itemName: supplyItem.name,
        category: supplyItem.category || 'General Supplies',
        buyUnit: supplyItem.buy_unit || ''
    });
    if (deductResult.error) {
        throw deductResult.error;
    }

    const creditResult = await repositories.adjustSupplyStoreStockByBranch(context, toBranchId, supplyItem.id, qty, {
        itemName: supplyItem.name,
        category: supplyItem.category || 'General Supplies',
        buyUnit: supplyItem.buy_unit || '',
        latestUnitCost: toNumber(payload.latestUnitCost)
    });
    if (creditResult.error) {
        await repositories.adjustSupplyStoreStockByBranch(context, fromBranchId, supplyItem.id, qty, {
            itemName: supplyItem.name,
            category: supplyItem.category || 'General Supplies',
            buyUnit: supplyItem.buy_unit || ''
        });
        throw creditResult.error;
    }

    const transferResult = await repositories.insertSupplyTransfer(context, {
        fromBranchId,
        toBranchId,
        supplyItemId: supplyItem.id,
        itemName: supplyItem.name,
        qty,
        buyUnit: supplyItem.buy_unit || '',
        notes: payload.notes || '',
        createdBy: payload.createdBy || 'Staff'
    });
    if (transferResult.error) {
        await repositories.adjustSupplyStoreStockByBranch(context, toBranchId, supplyItem.id, -qty, {
            itemName: supplyItem.name,
            category: supplyItem.category || 'General Supplies',
            buyUnit: supplyItem.buy_unit || ''
        });
        await repositories.adjustSupplyStoreStockByBranch(context, fromBranchId, supplyItem.id, qty, {
            itemName: supplyItem.name,
            category: supplyItem.category || 'General Supplies',
            buyUnit: supplyItem.buy_unit || ''
        });
        throw transferResult.error;
    }

    return {
        data: {
            transfer: transferResult.data,
            sourceStore: deductResult.data,
            destinationStore: creditResult.data
        },
        error: null
    };
}
