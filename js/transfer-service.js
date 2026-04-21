function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

async function rollbackStockMove(repositories, context, branchId, materialName, qty) {
    const rollbackResult = await repositories.adjustRawMaterialStoreStockByBranch(
        context,
        branchId,
        materialName,
        qty
    );

    return rollbackResult.error || null;
}

async function ensureDestinationMaterial(repositories, context, branchId, sourceMaterial) {
    const destinationLookup = await repositories.getRawMaterialByBranch(
        context,
        branchId,
        sourceMaterial.name
    );
    if (destinationLookup.error) {
        throw destinationLookup.error;
    }

    if (destinationLookup.data?.id) {
        return destinationLookup.data;
    }

    const creationResult = await repositories.createRawMaterialInBranch(context, branchId, {
        name: sourceMaterial.name,
        buyUnit: sourceMaterial.buy_unit,
        storeUnit: sourceMaterial.store_unit,
        conversionFactor: toNumber(sourceMaterial.conversion_factor) || 1,
        price: toNumber(sourceMaterial.price),
        reorderLevel: sourceMaterial.reorder_level ?? null,
        stockLevel: 0,
        currentStock: 0
    });

    if (creationResult.error) {
        throw creationResult.error;
    }

    return creationResult.data;
}

function ensureBranchMap(branches = []) {
    return new Map((branches || []).map((branch) => [String(branch.id), branch]));
}

export async function transferRawMaterial(context, repositories, payload) {
    const fromBranchId = String(payload?.fromBranchId || '').trim();
    const toBranchId = String(payload?.toBranchId || '').trim();
    const materialName = String(payload?.materialName || '').trim();
    const qty = toNumber(payload?.qty);
    const notes = String(payload?.notes || '').trim() || null;
    const createdBy = String(payload?.createdBy || '').trim() || null;

    if (!context?.restaurantId) {
        throw new Error('A restaurant scope is required before transferring stock.');
    }

    if (!fromBranchId || !toBranchId) {
        throw new Error('Select both source and destination branches for the transfer.');
    }

    if (fromBranchId === toBranchId) {
        throw new Error('Source and destination branches must be different.');
    }

    if (!materialName) {
        throw new Error('Select a raw material to transfer.');
    }

    if (qty <= 0) {
        throw new Error('Transfer quantity must be greater than 0.');
    }

    const [
        { data: branches, error: branchesError },
        { data: sourceMaterial, error: sourceError },
        { data: destinationMaterial, error: destinationError }
    ] = await Promise.all([
        repositories.getBranches(context),
        repositories.getRawMaterialByBranch(context, fromBranchId, materialName),
        repositories.getRawMaterialByBranch(context, toBranchId, materialName)
    ]);

    if (branchesError) throw branchesError;
    if (sourceError) throw sourceError;
    if (destinationError) throw destinationError;

    const branchMap = ensureBranchMap(branches);
    const fromBranch = branchMap.get(fromBranchId);
    const toBranch = branchMap.get(toBranchId);

    if (!fromBranch || !toBranch) {
        throw new Error('One or both selected branches were not found.');
    }

    if (String(fromBranch.restaurant_id) !== String(context.restaurantId) || String(toBranch.restaurant_id) !== String(context.restaurantId)) {
        throw new Error('Transfers are only allowed within the current restaurant.');
    }

    if (fromBranch.is_active === false || toBranch.is_active === false) {
        throw new Error('Transfers are only allowed between active branches.');
    }

    if (!sourceMaterial?.id) {
        throw new Error(`Raw material "${materialName}" was not found in the source branch store stock.`);
    }

    const ensuredDestinationMaterial = destinationMaterial?.id
        ? destinationMaterial
        : await ensureDestinationMaterial(repositories, context, toBranchId, sourceMaterial);

    const sourceAvailableQty = toNumber(sourceMaterial.stock_level ?? sourceMaterial.current_stock);
    if (qty > sourceAvailableQty) {
        const sourceUnit = sourceMaterial.store_unit || ensuredDestinationMaterial.store_unit || 'store unit';
        throw new Error(
            `Insufficient store stock for ${materialName} in ${fromBranch.name}. ` +
            `Available: ${sourceAvailableQty} ${sourceUnit}. Needed: ${qty} ${sourceUnit}.`
        );
    }

    const transferUnit = ensuredDestinationMaterial.store_unit || sourceMaterial.store_unit || payload?.unit || 'store unit';

    const deductResult = await repositories.adjustRawMaterialStoreStockByBranch(
        context,
        fromBranchId,
        materialName,
        -qty
    );
    if (deductResult.error) {
        throw deductResult.error;
    }

    const creditResult = await repositories.adjustRawMaterialStoreStockByBranch(
        context,
        toBranchId,
        materialName,
        qty
    );
    if (creditResult.error) {
        const sourceRollbackError = await rollbackStockMove(
            repositories,
            context,
            fromBranchId,
            materialName,
            qty
        );

        if (sourceRollbackError) {
            throw new Error(
                `${creditResult.error.message} Source rollback also failed: ${sourceRollbackError.message}`
            );
        }

        throw creditResult.error;
    }

    const transferResult = await repositories.insertStockTransfer(context, {
        fromBranchId,
        toBranchId,
        materialName,
        qty,
        unit: transferUnit,
        notes,
        createdBy
    });

    if (transferResult.error) {
        const [destinationRollbackError, sourceRollbackError] = await Promise.all([
            rollbackStockMove(repositories, context, toBranchId, materialName, -qty),
            rollbackStockMove(repositories, context, fromBranchId, materialName, qty)
        ]);

        const rollbackErrors = [destinationRollbackError, sourceRollbackError]
            .filter(Boolean)
            .map((error) => error.message);

        if (rollbackErrors.length) {
            throw new Error(
                `${transferResult.error.message} Rollback also failed: ${rollbackErrors.join(' | ')}`
            );
        }

        throw transferResult.error;
    }

    return {
        data: {
            transfer: transferResult.data,
            fromBranch,
            toBranch,
            sourceMaterial: deductResult.data,
            destinationMaterial: creditResult.data
        },
        error: null
    };
}
