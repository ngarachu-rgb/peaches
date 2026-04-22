const TABLES_WITH_BRANCH = new Set([
    'inventory',
    'main_store',
    'recipes',
    'stock_receipts',
    'bar_stock_issues',
    'shifts',
    'shift_inventory',
    'expenses',
    'debts'
]);

// Keep the app branch-centered in code, but only touch branch_id on tables
// that have already been migrated in the database.
const BRANCH_READY_TABLES = new Set([
    'shifts',
    'main_store',
    'stock_receipts',
    'bar_stock_issues',
    'expenses',
    'debts'
]);

function tableSupportsBranch(tableName) {
    return TABLES_WITH_BRANCH.has(tableName) && BRANCH_READY_TABLES.has(tableName);
}

function toNumber(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : 0;
}

function selectColumns(tableName, columns) {
    return tableSupportsBranch(tableName) ? `${columns}, branch_id` : columns;
}

const LEGACY_SHIFT_COLUMNS = [
    'id',
    'restaurant_id',
    'created_at',
    'total_sales',
    'mpesa_float',
    'mpesa_closing',
    'mpesa_withdrawals',
    'mpesa_income',
    'cash_at_hand',
    'total_expenses',
    'total_debts',
    'debts_collected',
    'variance',
    'closed_by'
].join(', ');

const LEGACY_SHIFT_INVENTORY_COLUMNS = [
    'id',
    'shift_id',
    'product_id',
    'bbf',
    'added_today',
    'close_qty',
    'sold_qty',
    'created_at'
].join(', ');

function sanitizeShiftPayload(payload = {}) {
    const allowedKeys = new Set([
        'restaurant_id',
        'branch_id',
        'created_at',
        'total_sales',
        'mpesa_float',
        'mpesa_closing',
        'mpesa_withdrawals',
        'mpesa_income',
        'cash_at_hand',
        'total_expenses',
        'total_debts',
        'debts_collected',
        'variance',
        'closed_by'
    ]);

    const nextPayload = {};
    Object.entries(payload).forEach(([key, value]) => {
        if (allowedKeys.has(key)) {
            nextPayload[key] = value;
        }
    });

    return nextPayload;
}

function sanitizeShiftInventoryPayload(payload = {}) {
    const allowedKeys = new Set([
        'id',
        'shift_id',
        'product_id',
        'bbf',
        'added_today',
        'close_qty',
        'sold_qty'
    ]);

    const nextPayload = {};
    Object.entries(payload).forEach(([key, value]) => {
        if (allowedKeys.has(key)) {
            nextPayload[key] = value;
        }
    });

    return nextPayload;
}

function applyScope(query, tableName, context, options = {}) {
    const scopedByRestaurant = options.restaurant !== false;
    const scopedByBranch = options.branch !== false;
    let nextQuery = query;

    if (scopedByRestaurant && context?.restaurantId) {
        nextQuery = nextQuery.eq('restaurant_id', context.restaurantId);
    }

    if (
        scopedByBranch &&
        context?.useBranchScope &&
        context?.branchId &&
        tableSupportsBranch(tableName)
    ) {
        nextQuery = nextQuery.eq('branch_id', context.branchId);
    }

    return nextQuery;
}

function attachBranchPayload(tableName, context, payload) {
    if (
        context?.useBranchScope &&
        context?.branchId &&
        tableSupportsBranch(tableName)
    ) {
        return { ...payload, branch_id: context.branchId };
    }

    return payload;
}

async function fetchFirstRow(query) {
    const { data, error } = await query.limit(1);
    if (error) {
        return { data: null, error };
    }

    return { data: data?.[0] || null, error: null };
}

function ensureRowId(row) {
    if (row.id) {
        return row;
    }

    return {
        ...row,
        id: crypto.randomUUID()
    };
}

function isMissingColumnError(error, tableNameOrColumnName, columnName = '') {
    if (!error) return false;
    const message = String(error?.message || '').toLowerCase();

    if (!columnName) {
        return (
            message.includes('column') &&
            message.includes(String(tableNameOrColumnName || '').toLowerCase()) &&
            message.includes('does not exist')
        );
    }

    const tableName = String(tableNameOrColumnName || '').toLowerCase();
    const targetColumn = String(columnName || '').toLowerCase();

    return (
        (message.includes(`column ${tableName}.${targetColumn}`) && message.includes('does not exist')) ||
        (message.includes(`could not find the '${targetColumn}' column of '${tableName}'`) && message.includes('schema cache'))
    );
}

function isMissingRelationError(error, relationName) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes(`relation "${String(relationName || '').toLowerCase()}" does not exist`);
}

function isForeignKeyConstraintError(error, constraintName) {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('violates foreign key constraint') &&
        message.includes(String(constraintName || '').toLowerCase())
    );
}

async function runMutationAttempts(mutate, attempts, retryConfig = []) {
    let lastError = null;

    for (const payload of attempts) {
        const result = await mutate(payload);
        if (!result.error) {
            return result;
        }

        lastError = result.error;
        const canRetry = retryConfig.some(({ tableName, columnName }) => {
            if (!tableName || !columnName) return false;
            return (
                isMissingColumnError(result.error, tableName, columnName) ||
                isForeignKeyConstraintError(result.error, `${tableName}_${columnName}_fkey`) ||
                isForeignKeyConstraintError(result.error, `${tableName}_${columnName}_foreign`)
            );
        });

        if (!canRetry) {
            break;
        }
    }

    return { data: null, error: lastError };
}

async function runProfileMutation(context, mutationBuilder, attempts) {
    let lastError = null;

    for (const payload of attempts) {
        const { error, data } = await applyScope(
            mutationBuilder(payload),
            'profiles',
            context
        );

        if (!error) {
            return { data, error: null };
        }

        lastError = error;

        const profileSchemaIssue =
            isMissingColumnError(error, 'profiles', 'full_name') ||
            isMissingColumnError(error, 'profiles', 'name') ||
            isMissingColumnError(error, 'profiles', 'email') ||
            isMissingColumnError(error, 'profiles', 'username') ||
            isMissingColumnError(error, 'profiles', 'role') ||
            isMissingColumnError(error, 'profiles', 'is_active') ||
            isMissingColumnError(error, 'profiles', 'branch_id');

        if (!profileSchemaIssue) {
            break;
        }
    }

    return { data: null, error: lastError };
}

export function createRepositories(supabase) {
    return {
        signIn(email, password) {
            return supabase.auth.signInWithPassword({ email, password });
        },

        signOut() {
            return supabase.auth.signOut();
        },

        getProfile(userId) {
            return supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();
        },

        getStaffProfiles(context) {
            return applyScope(
                supabase
                    .from('profiles')
                    .select('*'),
                'profiles',
                context
            );
        },

        async getBranches(context) {
            const withConfig = await applyScope(
                supabase
                    .from('branches')
                    .select('id, restaurant_id, code, name, shift_system, operating_mode, is_active, created_at')
                    .order('code', { ascending: true }),
                'branches',
                context,
                { branch: false }
            );

            if (!withConfig.error) {
                return withConfig;
            }

            if (!isMissingColumnError(withConfig.error, 'branches', 'operating_mode')) {
                return withConfig;
            }

            const withShiftSystem = await applyScope(
                supabase
                    .from('branches')
                    .select('id, restaurant_id, code, name, shift_system, is_active, created_at')
                    .order('code', { ascending: true }),
                'branches',
                context,
                { branch: false }
            );

            if (!withShiftSystem.error || !isMissingColumnError(withShiftSystem.error, 'branches', 'shift_system')) {
                return withShiftSystem;
            }

            return applyScope(
                supabase
                    .from('branches')
                    .select('id, restaurant_id, code, name, is_active, created_at')
                    .order('code', { ascending: true }),
                'branches',
                context,
                { branch: false }
            );
        },

        async getBranchById(context, branchId) {
            const withConfig = await fetchFirstRow(
                applyScope(
                    supabase
                        .from('branches')
                        .select('id, restaurant_id, code, name, shift_system, operating_mode, is_active, created_at')
                        .eq('id', branchId),
                    'branches',
                    context,
                    { branch: false }
                )
            );

            if (!withConfig.error) {
                return withConfig;
            }

            if (!isMissingColumnError(withConfig.error, 'branches', 'operating_mode')) {
                return withConfig;
            }

            const withShiftSystem = await fetchFirstRow(
                applyScope(
                    supabase
                        .from('branches')
                        .select('id, restaurant_id, code, name, shift_system, is_active, created_at')
                        .eq('id', branchId),
                    'branches',
                    context,
                    { branch: false }
                )
            );

            if (!withShiftSystem.error || !isMissingColumnError(withShiftSystem.error, 'branches', 'shift_system')) {
                return withShiftSystem;
            }

            return fetchFirstRow(
                applyScope(
                    supabase
                        .from('branches')
                        .select('id, restaurant_id, code, name, is_active, created_at')
                        .eq('id', branchId),
                    'branches',
                    context,
                    { branch: false }
                )
            );
        },

        async createStaffProfile(context, payload) {
            const attempts = [
                {
                    id: payload.id,
                    restaurant_id: context.restaurantId,
                    branch_id: payload.branchId,
                    default_branch_id: payload.defaultBranchId,
                    email: payload.email,
                    username: payload.username,
                    full_name: payload.fullName,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    id: payload.id,
                    restaurant_id: context.restaurantId,
                    branch_id: payload.branchId,
                    email: payload.email,
                    username: payload.username,
                    full_name: payload.fullName,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    id: payload.id,
                    restaurant_id: context.restaurantId,
                    username: payload.username,
                    full_name: payload.fullName,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    id: payload.id,
                    restaurant_id: context.restaurantId,
                    username: payload.username,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    id: payload.id,
                    restaurant_id: context.restaurantId,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    id: payload.id,
                    restaurant_id: context.restaurantId
                }
            ];

            return runProfileMutation(
                context,
                (record) => supabase.from('profiles').insert([record]),
                attempts
            );
        },

        async updateStaffProfile(context, profileId, payload) {
            const attempts = [
                {
                    full_name: payload.fullName,
                    branch_id: payload.branchId,
                    default_branch_id: payload.defaultBranchId,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    name: payload.fullName,
                    branch_id: payload.branchId,
                    role: payload.role,
                    is_active: payload.isActive
                },
                {
                    branch_id: payload.branchId,
                    role: payload.role,
                    is_active: payload.isActive
                }
            ];

            return runProfileMutation(
                context,
                (record) => supabase
                    .from('profiles')
                    .update(record)
                    .eq('id', profileId),
                attempts
            );
        },

        async createStaffUserSecure(context, payload) {
            const result = await supabase.functions.invoke('create-staff-user', {
                body: {
                    restaurant_id: context.restaurantId,
                    branch_id: context.branchId,
                    username: payload.username,
                    full_name: payload.fullName,
                    role: payload.role,
                    is_active: payload.isActive,
                    password: payload.password
                }
            });

            if (result.error) {
                const message = String(result.error.message || '');
                if (message.toLowerCase().includes('failed to send a request')) {
                    return {
                        data: null,
                        error: new Error('Secure staff provisioning is not reachable yet. Deploy the Supabase Edge Function `create-staff-user` and try again.')
                    };
                }

                return result;
            }

            return result;
        },

        getOpenShifts(context) {
            return applyScope(
                supabase
                    .from('shifts')
                    .select(selectColumns('shifts', LEGACY_SHIFT_COLUMNS))
                    .is('total_sales', null)
                    .order('created_at', { ascending: false }),
                'shifts',
                context
            );
        },

        async getOpenShift(context) {
            return fetchFirstRow(this.getOpenShifts(context));
        },

        async getLatestClosedShift(context) {
            return fetchFirstRow(applyScope(
                supabase
                    .from('shifts')
                    .select(selectColumns('shifts', LEGACY_SHIFT_COLUMNS))
                    .not('total_sales', 'is', null)
                    .order('created_at', { ascending: false }),
                'shifts',
                context
            ));
        },

        async getLatestShift(context) {
            return fetchFirstRow(applyScope(
                supabase
                    .from('shifts')
                    .select(selectColumns('shifts', LEGACY_SHIFT_COLUMNS))
                    .order('created_at', { ascending: false }),
                'shifts',
                context
            ));
        },

        createShift(context, payload) {
            const record = sanitizeShiftPayload(
                attachBranchPayload('shifts', context, {
                    restaurant_id: context.restaurantId,
                    created_at: payload.created_at || new Date().toISOString(),
                    ...payload
                })
            );

            return supabase
                .from('shifts')
                .insert([record])
                .select('*')
                .single();
        },

        updateShift(shiftId, payload) {
            return supabase
                .from('shifts')
                .update(sanitizeShiftPayload(payload))
                .eq('id', shiftId)
                .select('*')
                .single();
        },

        deleteShift(shiftId) {
            return supabase
                .from('shifts')
                .delete()
                .eq('id', shiftId);
        },

        async getProducts(context) {
            const activeOnlyResult = await applyScope(
                supabase
                    .from('inventory')
                    .select(selectColumns('inventory', 'id, restaurant_id, name, price, category, is_active'))
                    .eq('is_active', true)
                    .order('name', { ascending: true }),
                'inventory',
                context
            );

            if (!isMissingColumnError(activeOnlyResult.error, 'is_active')) {
                return activeOnlyResult;
            }

            return applyScope(
                supabase
                    .from('inventory')
                    .select(selectColumns('inventory', 'id, restaurant_id, name, price, category'))
                    .order('name', { ascending: true }),
                'inventory',
                context
            );
        },

        saveProduct(context, payload, id = '') {
            const record = attachBranchPayload('inventory', context, {
                restaurant_id: context.restaurantId,
                name: payload.name,
                price: payload.price,
                category: payload.category
            });

            if (id) {
                return supabase.from('inventory').update(record).eq('id', id);
            }

            return supabase.from('inventory').insert([record]);
        },

        async importProducts(context, batch, existingProducts = []) {
            const byName = new Map(
                (existingProducts || []).map((product) => [
                    String(product.name || '').trim().toLowerCase(),
                    product
                ])
            );

            const results = [];

            for (const row of batch) {
                const key = String(row.name || '').trim().toLowerCase();
                const existing = byName.get(key);
                const record = attachBranchPayload('inventory', context, {
                    restaurant_id: row.restaurant_id || context.restaurantId,
                    name: row.name,
                    price: row.price,
                    category: row.category
                });

                let response;
                if (existing?.product_id || existing?.id) {
                    response = await supabase
                        .from('inventory')
                        .update(record)
                        .eq('id', existing.product_id || existing.id);
                } else {
                    response = await supabase
                        .from('inventory')
                        .insert([record]);
                }

                if (response.error) {
                    return response;
                }

                results.push(response.data ?? null);
            }

            return { data: results, error: null };
        },

        deleteProduct(context, id) {
            return applyScope(
                supabase.from('inventory').delete().eq('id', id),
                'inventory',
                context
            );
        },

        deactivateProduct(context, id) {
            return applyScope(
                supabase
                    .from('inventory')
                    .update({ is_active: false })
                    .eq('id', id),
                'inventory',
                context
            );
        },

        deleteShiftInventoryByProduct(context, productId) {
            return applyScope(
                supabase.from('shift_inventory').delete().eq('product_id', productId),
                'shift_inventory',
                context,
                { restaurant: false }
            );
        },

        deleteShiftInventoryByShift(context, shiftId) {
            return applyScope(
                supabase.from('shift_inventory').delete().eq('shift_id', shiftId),
                'shift_inventory',
                context,
                { restaurant: false }
            );
        },

        getShiftInventory(context, shiftId) {
            return applyScope(
                supabase
                    .from('shift_inventory')
                    .select(selectColumns('shift_inventory', LEGACY_SHIFT_INVENTORY_COLUMNS))
                    .eq('shift_id', shiftId),
                'shift_inventory',
                context,
                { restaurant: false }
            );
        },

        async getShiftInventoryRow(context, shiftId, productId) {
            return fetchFirstRow(applyScope(
                supabase
                    .from('shift_inventory')
                    .select(selectColumns('shift_inventory', LEGACY_SHIFT_INVENTORY_COLUMNS))
                    .eq('shift_id', shiftId)
                    .eq('product_id', productId),
                'shift_inventory',
                context,
                { restaurant: false }
            ));
        },

        upsertShiftInventoryRows(context, rows) {
            const payload = rows.map((row) => attachBranchPayload(
                'shift_inventory',
                context,
                sanitizeShiftInventoryPayload(ensureRowId(row))
            ));
            return supabase.from('shift_inventory').upsert(payload, { onConflict: 'shift_id,product_id' });
        },

        async getRawMaterials(context) {
            const richerQuery = applyScope(
                supabase
                    .from('main_store')
                    .select(selectColumns('main_store', 'id, restaurant_id, name, buy_unit, store_unit, conversion_factor, price, current_stock, stock_level, reorder_level'))
                    .order('name', { ascending: true }),
                'main_store',
                context
            );

            const richerResult = await richerQuery;
            if (!richerResult.error || !isMissingColumnError(richerResult.error, 'main_store', 'reorder_level')) {
                return richerResult;
            }

            return applyScope(
                supabase
                    .from('main_store')
                    .select(selectColumns('main_store', 'id, restaurant_id, name, buy_unit, store_unit, conversion_factor, price, current_stock, stock_level'))
                    .order('name', { ascending: true }),
                'main_store',
                context
            );
        },

        async getRawMaterialByBranch(context, branchId, materialName) {
            const richerQuery = applyScope(
                supabase
                    .from('main_store')
                    .select(selectColumns('main_store', 'id, restaurant_id, name, buy_unit, store_unit, conversion_factor, price, current_stock, stock_level, reorder_level'))
                    .eq('branch_id', branchId)
                    .eq('name', materialName),
                'main_store',
                context,
                { branch: false }
            );

            const richerResult = await fetchFirstRow(richerQuery);
            if (!richerResult.error || !isMissingColumnError(richerResult.error, 'main_store', 'reorder_level')) {
                return richerResult;
            }

            return fetchFirstRow(
                applyScope(
                    supabase
                        .from('main_store')
                        .select(selectColumns('main_store', 'id, restaurant_id, name, buy_unit, store_unit, conversion_factor, price, current_stock, stock_level'))
                        .eq('branch_id', branchId)
                        .eq('name', materialName),
                    'main_store',
                    context,
                    { branch: false }
                )
            );
        },

        saveRawMaterial(context, payload, id = '') {
            const attempts = [
                attachBranchPayload('main_store', context, {
                    restaurant_id: context.restaurantId,
                    name: payload.name,
                    buy_unit: payload.buyUnit,
                    store_unit: payload.storeUnit,
                    conversion_factor: payload.conversionFactor,
                    price: payload.price,
                    reorder_level: payload.reorderLevel
                }),
                attachBranchPayload('main_store', context, {
                    restaurant_id: context.restaurantId,
                    name: payload.name,
                    buy_unit: payload.buyUnit,
                    store_unit: payload.storeUnit,
                    conversion_factor: payload.conversionFactor,
                    price: payload.price
                })
            ];

            const mutate = (record) => {
                if (id) {
                    return supabase.from('main_store').update(record).eq('id', id);
                }

                return supabase.from('main_store').insert([record]);
            };

            return runMutationAttempts(mutate, attempts, [
                { tableName: 'main_store', columnName: 'reorder_level' }
            ]);
        },

        deleteRawMaterial(context, id) {
            return applyScope(
                supabase.from('main_store').delete().eq('id', id),
                'main_store',
                context
            );
        },

        createRawMaterialInBranch(context, branchId, payload) {
            const attempts = [
                {
                    restaurant_id: context.restaurantId,
                    branch_id: branchId,
                    name: payload.name,
                    buy_unit: payload.buyUnit,
                    store_unit: payload.storeUnit,
                    conversion_factor: payload.conversionFactor,
                    price: payload.price,
                    reorder_level: payload.reorderLevel,
                    stock_level: toNumber(payload.stockLevel),
                    current_stock: toNumber(payload.currentStock)
                },
                {
                    restaurant_id: context.restaurantId,
                    branch_id: branchId,
                    name: payload.name,
                    buy_unit: payload.buyUnit,
                    store_unit: payload.storeUnit,
                    conversion_factor: payload.conversionFactor,
                    price: payload.price,
                    stock_level: toNumber(payload.stockLevel),
                    current_stock: toNumber(payload.currentStock)
                },
                {
                    restaurant_id: context.restaurantId,
                    branch_id: branchId,
                    name: payload.name,
                    buy_unit: payload.buyUnit,
                    store_unit: payload.storeUnit,
                    conversion_factor: payload.conversionFactor,
                    price: payload.price
                }
            ];

            return runMutationAttempts(
                (record) => supabase.from('main_store').insert([record]).select('*').single(),
                attempts,
                [
                    { tableName: 'main_store', columnName: 'reorder_level' },
                    { tableName: 'main_store', columnName: 'stock_level' },
                    { tableName: 'main_store', columnName: 'current_stock' }
                ]
            );
        },

        updateRawMaterialPrice(context, id, price) {
            return applyScope(
                supabase
                    .from('main_store')
                    .update({ price })
                    .eq('id', id),
                'main_store',
                context
            );
        },

        async importRawMaterials(context, batch, existingMaterials = []) {
            const byName = new Map(
                (existingMaterials || []).map((material) => [
                    String(material.name || '').trim().toLowerCase(),
                    material
                ])
            );

            const results = [];

            for (const row of batch) {
                const key = String(row.name || '').trim().toLowerCase();
                const existing = byName.get(key);
                const record = attachBranchPayload('main_store', context, {
                    restaurant_id: row.restaurant_id || context.restaurantId,
                    name: row.name,
                    buy_unit: row.buy_unit,
                    store_unit: row.store_unit,
                    conversion_factor: row.conversion_factor,
                    price: row.price
                });

                let response;
                if (existing?.id) {
                    response = await supabase
                        .from('main_store')
                        .update(record)
                        .eq('id', existing.id);
                } else {
                    response = await supabase
                        .from('main_store')
                        .insert([record]);
                }

                if (response.error) {
                    return response;
                }

                results.push(response.data ?? null);
            }

            return { data: results, error: null };
        },

        getRecipes(context) {
            return applyScope(
                supabase
                    .from('recipes')
                    .select(selectColumns('recipes', 'id, restaurant_id, finished_item_name, material_name, qty_per_unit'))
                    .order('finished_item_name', { ascending: true }),
                'recipes',
                context
            );
        },

        upsertRecipes(context, batch) {
            const payload = batch.map((row) => attachBranchPayload('recipes', context, row));
            return supabase
                .from('recipes')
                .upsert(payload, { onConflict: 'restaurant_id,finished_item_name,material_name' });
        },

        async importRecipes(context, batch) {
            const payload = batch.map((row) => attachBranchPayload('recipes', context, {
                restaurant_id: row.restaurant_id || context.restaurantId,
                finished_item_name: row.finished_item_name,
                material_name: row.material_name,
                qty_per_unit: row.qty_per_unit
            }));

            return supabase
                .from('recipes')
                .upsert(payload, { onConflict: 'restaurant_id,finished_item_name,material_name' });
        },

        deleteRecipeRow(context, id) {
            return applyScope(
                supabase.from('recipes').delete().eq('id', id),
                'recipes',
                context
            );
        },

        getStockReceipts(context) {
            return applyScope(
                supabase
                    .from('stock_receipts')
                    .select(selectColumns('stock_receipts', 'id, restaurant_id, material_name, qty_received, received_by, created_at, buy_unit, store_unit, conversion_factor, qty_posted_store, buy_unit_price, store_unit_price, total_received_cost'))
                    .order('created_at', { ascending: false }),
                'stock_receipts',
                context
            );
        },

        getStockReceiptsByRange(context, startDate, endDate) {
            const effectiveEndDate = endDate || startDate;
            return applyScope(
                supabase
                    .from('stock_receipts')
                    .select(selectColumns('stock_receipts', 'id, restaurant_id, material_name, qty_received, received_by, created_at, buy_unit, store_unit, conversion_factor, qty_posted_store, buy_unit_price, store_unit_price, total_received_cost'))
                    .filter('created_at', 'gte', `${startDate}T00:00:00Z`)
                    .filter('created_at', 'lte', `${effectiveEndDate}T23:59:59Z`)
                    .order('created_at', { ascending: false }),
                'stock_receipts',
                context
            );
        },

        insertStockReceipt(context, payload) {
            const attempts = [
                attachBranchPayload('stock_receipts', context, {
                    restaurant_id: context.restaurantId,
                    material_name: payload.materialName,
                    qty_received: payload.qtyReceived,
                    received_by: payload.receivedBy,
                    buy_unit: payload.buyUnit,
                    store_unit: payload.storeUnit,
                    conversion_factor: payload.conversionFactor,
                    qty_posted_store: payload.qtyPostedStore,
                    buy_unit_price: payload.buyUnitPrice,
                    store_unit_price: payload.storeUnitPrice,
                    total_received_cost: payload.totalReceivedCost
                }),
                attachBranchPayload('stock_receipts', context, {
                    restaurant_id: context.restaurantId,
                    material_name: payload.materialName,
                    qty_received: payload.qtyReceived,
                    received_by: payload.receivedBy
                })
            ];

            return runMutationAttempts(
                (record) => supabase.from('stock_receipts').insert([record]).select('*').single(),
                attempts,
                [
                    { tableName: 'stock_receipts', columnName: 'buy_unit' },
                    { tableName: 'stock_receipts', columnName: 'store_unit' },
                    { tableName: 'stock_receipts', columnName: 'conversion_factor' },
                    { tableName: 'stock_receipts', columnName: 'qty_posted_store' },
                    { tableName: 'stock_receipts', columnName: 'buy_unit_price' },
                    { tableName: 'stock_receipts', columnName: 'store_unit_price' },
                    { tableName: 'stock_receipts', columnName: 'total_received_cost' }
                ]
            );
        },

        deleteStockReceipt(context, id) {
            return applyScope(
                supabase.from('stock_receipts').delete().eq('id', id),
                'stock_receipts',
                context
            );
        },

        incrementStoreStock(context, materialName, amount) {
            return supabase.rpc('increment_store_stock', {
                m_name: materialName,
                m_rest_id: context.restaurantId,
                amount
            });
        },

        async adjustRawMaterialStoreStock(context, materialName, delta) {
            const { data, error } = await fetchFirstRow(applyScope(
                supabase
                    .from('main_store')
                    .select(selectColumns('main_store', 'id, restaurant_id, name, current_stock, stock_level'))
                    .eq('name', materialName),
                'main_store',
                context
            ));
            if (error) return { data: null, error };
            if (!data?.id) {
                return { data: null, error: new Error(`Raw material "${materialName}" was not found in store stock.`) };
            }

            const currentValue = toNumber(data.stock_level ?? data.current_stock);
            const nextValue = currentValue + toNumber(delta);
            if (nextValue < 0) {
                return { data: null, error: new Error(`Insufficient store stock for ${materialName}. Available: ${currentValue}. Needed: ${Math.abs(toNumber(delta))}.`) };
            }

            return supabase
                .from('main_store')
                .update({
                    stock_level: nextValue,
                    current_stock: nextValue
                })
                .eq('id', data.id)
                .select('*')
                .single();
        },

        async adjustRawMaterialStoreStockByBranch(context, branchId, materialName, delta) {
            const { data, error } = await fetchFirstRow(
                applyScope(
                    supabase
                        .from('main_store')
                        .select(selectColumns('main_store', 'id, restaurant_id, branch_id, name, current_stock, stock_level'))
                        .eq('branch_id', branchId)
                        .eq('name', materialName),
                    'main_store',
                    context,
                    { branch: false }
                )
            );
            if (error) return { data: null, error };
            if (!data?.id) {
                return {
                    data: null,
                    error: new Error(`Raw material "${materialName}" was not found in the selected branch store stock.`)
                };
            }

            const currentValue = toNumber(data.stock_level ?? data.current_stock);
            const nextValue = currentValue + toNumber(delta);
            if (nextValue < 0) {
                return {
                    data: null,
                    error: new Error(
                        `Insufficient store stock for ${materialName} in the selected branch. ` +
                        `Available: ${currentValue}. Needed: ${Math.abs(toNumber(delta))}.`
                    )
                };
            }

            return supabase
                .from('main_store')
                .update({
                    stock_level: nextValue,
                    current_stock: nextValue
                })
                .eq('id', data.id)
                .select('*')
                .single();
        },

        getStockTransfers(context) {
            return applyScope(
                supabase
                    .from('stock_transfers')
                    .select('id, restaurant_id, from_branch_id, to_branch_id, material_name, qty, unit, notes, created_by, created_at')
                    .order('created_at', { ascending: false }),
                'stock_transfers',
                context,
                { branch: false }
            );
        },

        getBarStockIssues(context) {
            const query = applyScope(
                supabase
                    .from('bar_stock_issues')
                    .select('id, restaurant_id, branch_id, shift_id, source_material_name, target_product_name, qty_issued_source, source_buy_unit, qty_added_target, target_unit, conversion_factor, notes, created_by, created_at')
                    .order('created_at', { ascending: false }),
                'bar_stock_issues',
                context
            );

            return (async () => {
                const result = await query;
                if (result.error && isMissingRelationError(result.error, 'bar_stock_issues')) {
                    return { data: [], error: null };
                }
                return result;
            })();
        },

        insertBarStockIssue(context, payload) {
            return supabase
                .from('bar_stock_issues')
                .insert([attachBranchPayload('bar_stock_issues', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    source_material_name: payload.sourceMaterialName,
                    target_product_name: payload.targetProductName,
                    qty_issued_source: payload.qtyIssuedSource,
                    source_buy_unit: payload.sourceBuyUnit,
                    qty_added_target: payload.qtyAddedTarget,
                    target_unit: payload.targetUnit,
                    conversion_factor: payload.conversionFactor,
                    notes: payload.notes,
                    created_by: payload.createdBy
                })])
                .select('*')
                .single();
        },

        deleteBarStockIssue(context, id) {
            return applyScope(
                supabase.from('bar_stock_issues').delete().eq('id', id),
                'bar_stock_issues',
                context
            );
        },

        getStockTransfersByRange(context, startDate, endDate) {
            const effectiveEndDate = endDate || startDate;
            return applyScope(
                supabase
                    .from('stock_transfers')
                    .select('id, restaurant_id, from_branch_id, to_branch_id, material_name, qty, unit, notes, created_by, created_at')
                    .filter('created_at', 'gte', `${startDate}T00:00:00Z`)
                    .filter('created_at', 'lte', `${effectiveEndDate}T23:59:59Z`)
                    .order('created_at', { ascending: false }),
                'stock_transfers',
                context,
                { branch: false }
            );
        },

        insertStockTransfer(context, payload) {
            return supabase
                .from('stock_transfers')
                .insert([{
                    restaurant_id: context.restaurantId,
                    from_branch_id: payload.fromBranchId,
                    to_branch_id: payload.toBranchId,
                    material_name: payload.materialName,
                    qty: payload.qty,
                    unit: payload.unit,
                    notes: payload.notes,
                    created_by: payload.createdBy
                }])
                .select('*')
                .single();
        },

        deleteStockTransfer(context, id) {
            return applyScope(
                supabase.from('stock_transfers').delete().eq('id', id),
                'stock_transfers',
                context,
                { branch: false }
            );
        },

        insertExpense(context, payload) {
            const attempts = [
                attachBranchPayload('expenses', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    amount: payload.amount,
                    description: payload.description,
                    qty: payload.qty,
                    unit_cost: payload.unitCost,
                    notes: payload.notes,
                    created_by: payload.createdBy
                }),
                attachBranchPayload('expenses', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    amount: payload.amount,
                    description: payload.description,
                    qty: payload.qty,
                    unit_cost: payload.unitCost,
                    notes: payload.notes
                }),
                attachBranchPayload('expenses', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    amount: payload.amount,
                    description: payload.description
                }),
                attachBranchPayload('expenses', context, {
                    restaurant_id: context.restaurantId,
                    amount: payload.amount,
                    description: payload.description
                })
            ];

            return runMutationAttempts(
                (record) => supabase.from('expenses').insert([record]),
                attempts,
                [
                    { tableName: 'expenses', columnName: 'shift_id' },
                    { tableName: 'expenses', columnName: 'qty' },
                    { tableName: 'expenses', columnName: 'unit_cost' },
                    { tableName: 'expenses', columnName: 'notes' },
                    { tableName: 'expenses', columnName: 'created_by' }
                ]
            );
        },

        insertDebt(context, payload) {
            const attempts = [
                attachBranchPayload('debts', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    amount: payload.amount,
                    transaction_type: payload.transactionType,
                    client_name: payload.clientName,
                    phone: payload.phone,
                    notes: payload.notes,
                    created_by: payload.createdBy
                }),
                attachBranchPayload('debts', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    amount: payload.amount,
                    transaction_type: payload.transactionType,
                    client_name: payload.clientName,
                    phone: payload.phone,
                    notes: payload.notes
                }),
                attachBranchPayload('debts', context, {
                    restaurant_id: context.restaurantId,
                    shift_id: payload.shiftId,
                    amount: payload.amount,
                    client_name: payload.clientName,
                    phone: payload.phone
                }),
                attachBranchPayload('debts', context, {
                    restaurant_id: context.restaurantId,
                    amount: payload.amount
                })
            ];

            return runMutationAttempts(
                (record) => supabase.from('debts').insert([record]),
                attempts,
                [
                    { tableName: 'debts', columnName: 'shift_id' },
                    { tableName: 'debts', columnName: 'transaction_type' },
                    { tableName: 'debts', columnName: 'client_name' },
                    { tableName: 'debts', columnName: 'phone' },
                    { tableName: 'debts', columnName: 'notes' },
                    { tableName: 'debts', columnName: 'created_by' }
                ]
            );
        },

        getShiftReportsByRange(context, startDate, endDate) {
            const effectiveEndDate = endDate || startDate;
            return applyScope(
                supabase
                    .from('shifts')
                    .select(selectColumns('shifts', LEGACY_SHIFT_COLUMNS))
                    .filter('created_at', 'gte', `${startDate}T00:00:00Z`)
                    .filter('created_at', 'lte', `${effectiveEndDate}T23:59:59Z`)
                    .order('created_at', { ascending: false }),
                'shifts',
                context
            );
        },

        getDebtsByRange(context, startDate, endDate) {
            const effectiveEndDate = endDate || startDate;
            return applyScope(
                supabase
                    .from('debts')
                    .select(selectColumns('debts', 'id, restaurant_id, shift_id, transaction_type, client_name, phone, amount, notes, created_by, created_at'))
                    .filter('created_at', 'gte', `${startDate}T00:00:00Z`)
                    .filter('created_at', 'lte', `${effectiveEndDate}T23:59:59Z`)
                    .order('created_at', { ascending: false }),
                'debts',
                context
            );
        },

        getShiftById(context, shiftId) {
            return applyScope(
                supabase
                    .from('shifts')
                    .select(selectColumns('shifts', LEGACY_SHIFT_COLUMNS))
                    .eq('id', shiftId),
                'shifts',
                context
            ).single();
        },

        getShiftInventoryForShiftIds(context, shiftIds = []) {
            if (!shiftIds.length) {
                return Promise.resolve({ data: [], error: null });
            }

            return applyScope(
                supabase
                    .from('shift_inventory')
                    .select(selectColumns('shift_inventory', LEGACY_SHIFT_INVENTORY_COLUMNS))
                    .in('shift_id', shiftIds),
                'shift_inventory',
                context,
                { restaurant: false }
            );
        },

        updateShiftTotals(shiftId) {
            return supabase.rpc('update_shift_totals', { p_shift_id: shiftId });
        }
    };
}
