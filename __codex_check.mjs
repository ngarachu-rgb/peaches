
    import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
    const supabaseUrl = 'https://poepfebjdnhlszflhqzs.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvZXBmZWJqZG5obHN6ZmxocXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NzU5MDcsImV4cCI6MjA5MDE1MTkwN30.HT9-4TptQZwXewyQfwGHb0EGcZMDDIUSdt1eKlSwSoY';
    const supabase = createClient(supabaseUrl, supabaseKey);

    window.supabase = supabase;

    let state = { 
        user: null, 
        restaurantId: null, 
        items: [], 
        rawMaterials: [], 
        recipeMatrix: [], 
        currentShiftTotal: 0,
        currentShift: null,
        shift: {
            type: 'DAY',
            date: null,
            cash_bf: 0
        }
    };
    let currentShiftId = null;
    window.handleLogin = async () => {
        try {
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPass').value;
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;

            const { data: prof, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', data.user.id)
                .single();

            if (profileError) throw profileError;
            if (!prof || !prof.restaurant_id) {
                alert("User profile or restaurant_id missing");
                return;
            }

            state.user = prof;
            state.restaurantId = prof.restaurant_id;
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('sidebar').classList.remove('hidden');
            await initApp();
        } catch (err) {
            handleError(err, "Login failed");
        }
    };

    const handleError = (error, customMsg = "Something went wrong") => {
        console.error(error);
        alert(error?.message || customMsg);
    };

    const setLoading = (btn, state, text = "Processing...") => {
        if (!btn) return;
        btn.disabled = state;
        btn.dataset.originalText = btn.dataset.originalText || btn.innerText;
        btn.innerText = state ? text : btn.dataset.originalText;
    };    
    async function getNextShift() {
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('restaurant_id', state.restaurantId)
            .order('created_at', { ascending: false }) // ✅ more reliable
            .limit(1);

        if (error) {
            console.error(error);
            return { type: 'DAY', date: new Date().toISOString().split('T')[0], cash_bf: 0 };
        }

        // FIRST SHIFT EVER
        if (!data || data.length === 0) {
            return {
                type: 'DAY',
                date: new Date().toISOString().split('T')[0],
                cash_bf: 0
            };
        }

    function validateBeforeClose(shift) {
        if (!shift.closing_cash) {
            alert('Enter closing cash');
            return false;
        }

        // optionally check all products have closing_qty
        return true;
        }    

        const last = data[0];

        // DAY → NIGHT
        if (last.shift_type === 'DAY') {
            return {
                type: 'NIGHT',
                date: last.shift_date,
                cash_bf: last.cash_total || 0
            };
        }

        // NIGHT → NEXT DAY
        const nextDate = new Date(last.shift_date);
        nextDate.setDate(nextDate.getDate() + 1);

        return {
            type: 'DAY',
            date: nextDate.toISOString().split('T')[0],
            cash_bf: last.cash_total || 0
        };
    }
    
    async function closeShift(shiftId) {
    const { error } = await supabase.rpc('close_shift', {
        p_shift_id: shiftId
    });

    if (error) {
        alert('Error closing shift: ' + error.message);
        return;
    }

    alert('Shift closed successfully');

    // Reload data / move to new shift
    loadCurrentShift();
    }

    const initApp = async () => {
        state.shift = await getNextShift();
        await loadCurrentShift();
        await loadInventory();
        await loadRawMaterials();
        await loadRecipes();
        await loadStockReceipts();
        
        // 2. ONLY THEN show the page and render the table
        window.showPage('salesPage');
        window.renderSales(); // Explicitly call this to ensure the table draws
    };
    window.renderSales = () => {
        const body = document.getElementById('salesBody');
        if (!body) return;

        if (!state.items || state.items.length === 0) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px;">No products found. Add items in Finished Products.</td></tr>';
            return;
        }

        body.innerHTML = state.items.map(i => {
            const bbf = Number(i.bbf || 0);
            const added = Number(i.added_today || 0);
            const totalAvailable = bbf + added;
            const price = Number(i.price || 0);

            return `
                <tr>
                    <td style="padding:12px; font-weight:500;">${i.name}</td>
                    <td style="text-align:center; color:#666;">${bbf}</td>
                    <td style="text-align:center; color:#666;">${added}</td>
                    <td>
                        <input type="number" 
                            class="sales-input"
                            placeholder="Qty Left"
                            oninput="calcSalesRow(this, ${totalAvailable}, ${price})" 
                            data-id="${i.product_id}"
                            data-product-id="${i.product_id}"
                            data-shift-row-id="${i.id || ''}"
                            style="width:80px; padding:6px; border:1px solid #7092ae; border-radius:4px;">
                    </td>
                    <td id="sold_${i.product_id}" style="font-weight:bold; text-align:center; color: #2c3e50;">0</td>
                    <td id="amt_${i.product_id}" class="row-amt" style="font-weight:bold; text-align:right; padding-right:15px;">0</td>
                </tr>
            `;
        }).join('');
    };
    
    window.loadInventory = async () => {
        try {
            // 1. Get the list of products for this restaurant (The names)
            const { data: masterData, error: masterError } = await supabase
                .from('inventory')
                .select('id, name, price, category')
                .eq('restaurant_id', state.restaurantId);

            if (masterError) throw masterError;

            // 2. Get any existing shift data (The current counts)
            // If state.currentShift is missing, we just use an empty array []
            let shiftData = [];
            if (state.currentShift && state.currentShift.id) {
                const { data, error } = await supabase
                    .from('shift_inventory')
                    .select('*')
                    .eq('shift_id', state.currentShift.id);
                if (!error) shiftData = data;
            }

            // 3. Combine them: Always show the Master Name, use 0 if shift data is missing
            state.items = masterData.map(masterItem => {
                const shiftItem = shiftData.find(s => s.product_id === masterItem.id);
                return {
                    id: shiftItem ? shiftItem.id : null, // The row ID in shift_inventory
                    product_id: masterItem.id,
                    name: masterItem.name,
                    price: masterItem.price || 0,
                    category: masterItem.category || '',
                    added_today: shiftItem ? (shiftItem.added_today || 0) : 0,
                    bbf: shiftItem ? (shiftItem.bbf || 0) : 0,
                    sold: shiftItem ? (shiftItem.sold || 0) : 0,
                    spoilt: shiftItem ? (shiftItem.spoilt || 0) : 0,
                    closing_stock: shiftItem ? (shiftItem.closing_stock || shiftItem.close_qty || 0) : 0
                };
            });

            renderInventory();
            renderSales();
            renderFinishedProducts();
            if (typeof renderKitchen === 'function') renderKitchen();
            
        } catch (err) {
            console.error("Inventory Load Error:", err);
            handleError(err);
        }
    };

    window.renderInventory = () => {
        const tbody = document.getElementById('inventoryBody');
        if (!tbody) return; // Safety check
        
        tbody.innerHTML = '';

        if (state.items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">No items found. Click "Initialize Shift Items" or add items in Settings.</td></tr>';
            return;
        }

        state.items.forEach(item => {
            const row = document.createElement('tr');
            // We use the 'name' we mapped in loadInventory
            row.innerHTML = `
                <td>${item.name || 'Unknown'}</td>
                <td>${item.bbf || 0}</td>
                <td>${item.added_today || 0}</td>
                <td><input type="number" class="qty-input" value="${item.sold || 0}" onchange="updateItemField('${item.id}', 'sold', this.value)"></td>
                <td><input type="number" class="qty-input" value="${item.spoilt || 0}" onchange="updateItemField('${item.id}', 'spoilt', this.value)"></td>
                <td>${(Number(item.bbf || 0) + Number(item.added_today || 0)) - (Number(item.sold || 0) + Number(item.spoilt || 0))}</td>
                <td><input type="number" class="qty-input" value="${item.closing_stock || 0}" onchange="updateItemField('${item.id}', 'closing_stock', this.value)"></td>
            `;
            tbody.appendChild(row);
        });
    };
        
    window.deleteSellingProduct = async (id) => {
        // Ask for confirmation before deleting
        if (!confirm("Are you sure you want to delete this product? This will remove it from the sales sheet.")) return;
        
        try {
            const { error } = await supabase
                .from('inventory')
                .delete()
                .eq('id', id);

            if (error) throw error;

            await supabase
                .from('shift_inventory')
                .delete()
                .eq('product_id', id);
            
            alert("Product deleted successfully.");
            await loadInventory(); // Refresh the table
        } catch (err) {
            handleError(err, "Failed to delete product");
        }
    };
        
    window.calcSalesRow = (el, avail, price) => {
        const closing = Number(el.value);
        
        // 1. Calculate items sold and the row amount
        const sold = Math.max(0, avail - closing);
        const amount = sold * price;

        // 2. Update the specific row cells in the table
        document.getElementById(`sold_${el.dataset.id}`).innerText = sold;
        document.getElementById(`amt_${el.dataset.id}`).innerText = amount.toLocaleString();

        // 3. Recalculate the Grand Total from all rows
        let total = 0;
        document.querySelectorAll('.row-amt').forEach(td => {
            // Remove commas before converting back to a number for math
            total += Number(td.innerText.replace(/,/g, '')) || 0;
        });

        // 4. Update the global state and UI displays
        state.currentShiftTotal = total;
        
        // Update the floating blue bar
        const totalDisplay = document.getElementById('totalSalesDisplay');
        if (totalDisplay) totalDisplay.innerText = `KES ${total.toLocaleString()}`;
        
        // Update the reconciliation page total
        const totalVal = document.getElementById('totalSalesVal');
        if (totalVal) totalVal.innerText = total.toLocaleString();

        // Trigger reconciliation math automatically
        if (typeof calcRecon === "function") calcRecon();
    };
        
    window.filterSales = () => {
        const searchTerm = document.getElementById('salesSearch').value.toLowerCase();
        const rows = document.querySelectorAll('#salesBody tr');

        rows.forEach(row => {
            const itemName = row.cells[0].innerText.toLowerCase();
            if (itemName.includes(searchTerm)) {
                row.style.display = ""; // Show row
            } else {
                row.style.display = "none"; // Hide row
            }
        });
    };   
        
    window.calcRecon = () => {
        // 1. Get all input values
        const mpesaOpening = Number(document.getElementById('mpesaOpening').value) || 0;
        const mpesaClosing = Number(document.getElementById('mpesaClosing').value) || 0;
        const mpesaWithdraw = Number(document.getElementById('mpesaWithdraw').value) || 0;
        
        const cashAtHand = Number(document.getElementById('cashAtHand').value) || 0;
        const totalExpenses = Number(document.getElementById('totalExpenses').value) || 0;
        const debtGiven = Number(document.getElementById('debtGiven').value) || 0;
        const prevDebtsPaid = Number(document.getElementById('prevDebtsPaid').value) || 0;

        // 2. M-Pesa Income Calculation
        // Logic: mpesa BBF – Mpesa closing balance + withdrawals
        const mpesaIncome =  mpesaClosing + mpesaWithdraw - mpesaOpening;
        document.getElementById('netMpesa').innerText = mpesaIncome.toLocaleString(undefined, {minimumFractionDigits: 2});

        // 3. Total Income from Sales Calculation
        // Logic: Cash at hand + M-Pesa income + expenses + debt given - previous debts paid
        const incomeFromSales = cashAtHand + mpesaIncome + totalExpenses + debtGiven - prevDebtsPaid;
        document.getElementById('incomeFromSales').innerText = incomeFromSales.toLocaleString(undefined, {minimumFractionDigits: 2});

        // 4. Update Total Sales Display (from item sales)
        document.getElementById('totalSalesVal').innerText = state.currentShiftTotal.toLocaleString(undefined, {minimumFractionDigits: 2});

        // 5. Variance Calculation
        // Logic: total sale – income from sales
        const variance = state.currentShiftTotal - incomeFromSales;
        const varEl = document.getElementById('varianceVal');
        varEl.innerText = variance.toLocaleString(undefined, {minimumFractionDigits: 2});
        
        // UI Feedback: Green if balanced, Red if there's a discrepancy
        varEl.style.color = Math.abs(variance) < 0.01 ? 'green' : 'red';
    };

    window.loadRawMaterials = async () => {
        const { data, error } = await supabase
            .from('main_store')
            .select('*')
            .eq('restaurant_id', state.restaurantId)
            .order('name', { ascending: true });

        if (error) return handleError(error, "Failed to Load Raw Materials");
        
        state.rawMaterials = data || [];

        const rawBody = document.getElementById('rawMaterialBody');
        if (rawBody) {
            rawBody.innerHTML = state.rawMaterials.map(m => `
                <tr>
                    <td>${m.name}</td>
                    <td>${m.buy_unit}</td>
                    <td>${m.store_unit}</td>
                    <td>${m.conversion_factor}</td>
                    <td>${m.price}</td>
                    <td>${(m.price / m.conversion_factor).toFixed(2)}</td>
                    <td><button onclick="editRawMaterial('${m.id}')">Edit</button></td>
                </tr>`).join('');
        }
    }; 
        
    window.loadRecipes = async () => {
        const { data } = await supabase.from('recipes').select('*').eq('restaurant_id', state.restaurantId);
        state.recipeMatrix = data || [];
        document.getElementById('recipeMatrixBody').innerHTML = state.recipeMatrix.map(r => `<tr><td>${r.finished_item_name}</td><td>${r.material_name}</td><td>${Number(r.qty_per_unit).toFixed(4)}</td><td><button onclick="deleteRecipe('${r.id}')">X</button></td></tr>`).join('');
    };

    window.renderFinishedProducts = () => {
        const tbody = document.getElementById('finishedProductBody');
        if (!tbody) return;

        if (!state.items.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:30px;">No products found.</td></tr>';
            return;
        }

        tbody.innerHTML = state.items.map(item => `
            <tr>
                <td>${item.name}</td>
                <td>${item.category || '-'}</td>
                <td>${Number(item.price || 0).toFixed(2)}</td>
                <td style="text-align: right;">
                    <button class="btn" style="background:#edf2f7; margin-right:8px;" onclick="editSellingProduct('${item.product_id}')">Edit</button>
                    <button class="btn" style="background:#e74c3c; color:white;" onclick="deleteSellingProduct('${item.product_id}')">Delete</button>
                </td>
            </tr>
        `).join('');
    };

    window.editSellingProduct = (id) => {
        const item = state.items.find(product => product.product_id === id);
        if (!item) return;

        document.getElementById('productId').value = item.product_id;
        document.getElementById('pName').value = item.name || '';
        document.getElementById('pPrice').value = item.price || '';
        document.getElementById('pCat').value = item.category || 'Food';
        document.getElementById('prodFormTitle').innerText = "Edit Selling Item";
        document.getElementById('cancelProdBtn').style.display = "inline-block";
        document.getElementById('saveProdBtn').innerText = "Update Product";
    };

    window.saveMasterRecipe = async () => {
        const btn = document.getElementById('saveMasterBtn');
        setLoading(btn, true);

        try {
            const pName = document.getElementById('masterProductSelect').value;
            const yieldQty = Number(document.getElementById('recipeYield').value) || 1;

            if (!pName) {
                alert("Select a product");
                return;
            }

            const batch = [];

            for (let i = 1; i <= 3; i++) {
                const mat = document.getElementById(`ing${i}`).value;
                const q = Number(document.getElementById(`qty${i}`).value);

                if (mat && q > 0) {
                    batch.push({
                        restaurant_id: state.restaurantId,
                        finished_item_name: pName,
                        material_name: mat,
                        qty_per_unit: q / yieldQty
                    });
                }
            }

            if (batch.length === 0) {
                alert("Add at least one ingredient");
                return;
            }

            // 🔁 Instead of delete → use upsert (requires unique constraint)
            const { error } = await supabase
                .from('recipes')
                .upsert(batch, {
                    onConflict: 'restaurant_id,finished_item_name,material_name'
                });

            if (error) throw error;

            alert("Recipe updated successfully");
            loadRecipes();

        } catch (err) {
            handleError(err, "Failed to save recipe");
        } finally {
            setLoading(btn, false);
        }
    };

    window.loadProducts = async () => {
        const { data, error } = await supabase
            .from('inventory')
            .select('id, name')
            .eq('restaurant_id', state.restaurantId)
            .order('name', { ascending: true });

        if (error) return console.error(error);

        const select = document.getElementById('finishedItemSelect');
        if (select) {
            select.innerHTML = '<option value="">-- Select Product --</option>';
            data.forEach(p => {
                select.innerHTML += `<option value="${p.id}">${p.name}</option>`;
            });
        }
    };

    window.loadKitchenData= async function () {
        if (!currentShiftId) {
            console.log('No active shift');
            const tbody = document.getElementById('kitchenBody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="2">No active shift</td></tr>`;
            return;
        }

        const { data, error } = await supabase
            .from('shift_inventory')
            .select(`
            product_id,
            added_today,
            inventory(name)
            `)
            .eq('shift_id', currentShiftId);

        if (error) {
            console.error('Load error:', error);
            return;
        }

        console.log('Kitchen data:', data); // 🔍 DEBUG

        const tbody = document.getElementById('kitchenBody');
        tbody.innerHTML = '';

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="2">No production yet</td></tr>`;
            return;
        }

        data.forEach(row => {
            tbody.innerHTML += `
            <tr>
                <td>${row.inventory?.name || 'Unknown'}</td>
                <td>${row.added_today || 0}</td>
            </tr>
            `;
        });
        }

    window.processReverseDispatch = async function () {
        const productId = document.getElementById('finishedItemSelect').value;
        const qty = parseFloat(document.getElementById('productionQty').value) || 0;

        if (!productId || qty <= 0) {
            alert('Select product and enter quantity');
            return;
        }
        console.log('Posting production:', productId, qty, currentShiftId);

        // 🔹 STEP 1: Try to get existing row
        const { data: existing, error: fetchError } = await supabase
            .from('shift_inventory')
            .select('*')
            .eq('product_id', productId)
            .eq('shift_id', currentShiftId)
            .maybeSingle(); // 🔥 IMPORTANT (not .single)

        if (fetchError) {
            console.error('Fetch error:', fetchError);
            alert('Error fetching inventory');
            return;
        }

        // 🔹 STEP 2: INSERT if NOT EXISTS
        if (!existing) {
            console.log('No row found → inserting');

            const { error: insertError } = await supabase
            .from('shift_inventory')
            .insert({
                shift_id: currentShiftId,
                product_id: productId,
                bbf: 0,
                added_today: qty,
                close_qty: 0
            });

            if (insertError) {
            console.error('Insert error:', insertError);
            alert('Error inserting production');
            return;
            }

        } else {
            // 🔹 STEP 3: UPDATE if exists
            console.log('Row found → updating');

            const newQty = (existing.added_today || 0) + qty;

            const { error: updateError } = await supabase
            .from('shift_inventory')
            .update({ added_today: newQty })
            .eq('product_id', productId)
            .eq('shift_id', currentShiftId);

            if (updateError) {
            console.error('Update error:', updateError);
            alert('Error updating production');
            return;
            }
        }

        // 🔥 STEP 4: UPDATE SALES TOTALS (CRITICAL)
        await supabase.rpc('update_shift_totals', {
            p_shift_id: currentShiftId
        });

        // 🔥 STEP 5: REFRESH TABLE
        await loadKitchenData();

        // 🔹 RESET INPUT
        document.getElementById('productionQty').value = '';

        console.log('Production posted successfully');
    };

    window.renderKitchen = () => {
        const tbody = document.getElementById('kitchenBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        state.items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.name || 'Unknown'}</td>
                <td style="font-weight:bold; color:blue;">${item.added_today || 0}</td>
            `;
            tbody.appendChild(row);
        });
    };

     window.loadCurrentShift = async function() {
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('restaurant_id', state.restaurantId)
            .eq('status', 'OPEN')
            .order('created_at', { ascending: false })
            .maybeSingle();

        if (error && error.code !== 'PGRST116') {
            console.error(error);
            return;
        }

        state.currentShift = data || null;
        currentShiftId = data?.id || null;
        console.log('Current Shift:', currentShiftId);
    };

     window.initKitchenPage =async function() {
        await loadProducts();
        await loadCurrentShift();
        await loadKitchenData();
    };

    window.saveSellingProduct = async () => {
        const btn = document.getElementById('saveProdBtn');
        const id = document.getElementById('productId').value;
        const name = document.getElementById('pName').value;
        const price = Number(document.getElementById('pPrice').value);
        const category = document.getElementById('pCat').value;

        if (!name || price <= 0) return alert("Please enter a valid name and price.");
        setLoading(btn, true);

        const productData = {
            restaurant_id: state.restaurantId,
            name: name,
            price: price,
            category: category
        };

        try {
            let error;
            if (id) {
                // Update existing
                const { error: err } = await supabase.from('inventory').update(productData).eq('id', id);
                error = err;
            } else {
                // Insert new
                const { error: err } = await supabase.from('inventory').insert([productData]);
                error = err;
            }

            if (error) throw error;
            
            alert("Product saved successfully!");
            resetProductForm();
            await loadInventory(); // Refresh both the master list and sales table
            updateDropdowns();
        } catch (err) {
            handleError(err, "Failed to save product");
        } finally {
            setLoading(btn, false);
        }
    };

    window.resetProductForm = () => {
        document.getElementById('productId').value = "";
        document.getElementById('pName').value = "";
        document.getElementById('pPrice').value = "";
        document.getElementById('prodFormTitle').innerText = "Add New Selling Item";
        document.getElementById('cancelProdBtn').style.display = "none";
        document.getElementById('saveProdBtn').innerText = "Save Product";
    };

    window.processStockReceipt = async () => {
        const btn = document.querySelector('#stocksPage .btn.btn-success');
        setLoading(btn, true);

        try {
            const mId = document.getElementById('receiveMaterialSelect').value;
            const q = Number(document.getElementById('receiveQty').value);

            if (!mId || q <= 0) {
                alert("Invalid input");
                return;
            }

            const m = state.rawMaterials.find(x => x.id === mId);

            const { error: insertError } = await supabase
                .from('stock_receipts')
                .insert([{
                    restaurant_id: state.restaurantId,
                    material_name: m.name,
                    qty_received: q,
                    received_by: state.user.full_name
                }]);

            if (insertError) throw insertError;

            const { error: rpcError } = await supabase.rpc('increment_store_stock', {
                m_name: m.name,
                m_rest_id: state.restaurantId,
                amount: q
            });

            if (rpcError) throw rpcError;

            alert("Stock received successfully");

            await loadStockReceipts();
            await loadRawMaterials();

        } catch (err) {
            handleError(err, "Failed to record stock");
        } finally {
            setLoading(btn, false);
        }
    };

    window.finalizeShift = async () => {
        const btn = document.querySelector('#financePage .btn.btn-success');
        if (!confirm("Confirm Shift Closure? Individual expenses and debts will be logged for audit.")) return;
        setLoading(btn, true, "Finalizing Audit...");

        try {
            const timestamp = new Date().toISOString();

            // 1. Log Individual Expense
            const expenseTotal = Number(document.getElementById('totalExpenses').value) || 0;
            if (expenseTotal > 0) {
                await supabase.from('expenses').insert([{
                    restaurant_id: state.restaurantId,
                    amount: expenseTotal,
                    description: "Shift Total Expenses",
                    created_at: timestamp
                }]);
            }

            // 2. Log Individual Debt Given (Credit Sales)
            const debtG = Number(document.getElementById('debtGiven').value) || 0;
            if (debtG > 0) {
                await supabase.from('debts').insert([{
                    restaurant_id: state.restaurantId,
                    amount: debtG,
                    type: 'given', 
                    created_at: timestamp
                }]);
            }

            // 3. Log Previous Debt Paid (Collection)
            const debtP = Number(document.getElementById('prevDebtsPaid').value) || 0;
            if (debtP > 0) {
                await supabase.from('debts').insert([{
                    restaurant_id: state.restaurantId,
                    amount: debtP,
                    type: 'received',
                    created_at: timestamp
                }]);
            }

            // 4. Update Inventory
            const inventoryUpdates = [];
            const rows = document.querySelectorAll('#salesBody tr');
            rows.forEach(row => {
                const input = row.querySelector('input');
                if (input && currentShiftId) {
                    const closingBalance = Number(input.value) || 0;
                    const updateRow = {
                        shift_id: currentShiftId,
                        product_id: input.dataset.productId,
                        restaurant_id: state.restaurantId,
                        bbf: closingBalance,
                        added_today: 0
                    };

                    if (input.dataset.shiftRowId) {
                        updateRow.id = input.dataset.shiftRowId;
                    }

                    inventoryUpdates.push(updateRow);
                }
            });

            if (inventoryUpdates.length > 0) {
                await supabase.from('shift_inventory').upsert(inventoryUpdates);
            }

            // --- 5. FINALIZE SHIFT REPORT (DEBT LOGIC CORRECTED) ---
            const mOpen = Number(document.getElementById('mpesaOpening').value) || 0;
            const mClose = Number(document.getElementById('mpesaClosing').value) || 0;
            const mWith = Number(document.getElementById('mpesaWithdraw').value) || 0;
            const cashIn = Number(document.getElementById('cashAtHand').value) || 0;
            const salesTotal = state.currentShiftTotal || 0;

            const mIncome = mClose + mWith - mOpen;
            
            // Corrected Formula: Total Income = Mpesa + Cash + Debt Given + Expenses - Prev Debt Paid
            const totalAccountedIncome = mIncome + cashIn + debtG + expenseTotal - debtP;
            const finalVariance = totalAccountedIncome - salesTotal;

            const { error: shiftError } = await supabase.from('shifts').insert([{
                restaurant_id: state.restaurantId,
                created_at: timestamp,
                total_sales: salesTotal,
                mpesa_float: mOpen,
                mpesa_closing: mClose,
                mpesa_withdrawals: mWith,
                mpesa_income: mIncome,
                cash_at_hand: cashIn,
                total_expenses: expenseTotal,
                total_debts: debtG,          // Maps correctly to Debt Given
                debts_collected: debtP,      // Maps correctly to Prev Debt Paid
                variance: finalVariance,
                closed_by: state.user.full_name || state.user.email
            }]);

            if (shiftError) throw shiftError;

            alert("Shift finalized and reconciled!");
            
            // --- FIX: Don't reload, just navigate ---
            showPage('reportsPage'); 
            loadShiftReport(); // Refresh the report list automatically

        } catch (err) {
            handleError(err, "Audit Failure");
        } finally {
            setLoading(btn, false);
        }
    };   
    
    window.loadStockReceipts = async () => {
        const { data } = await supabase.from('stock_receipts').select('*').eq('restaurant_id', state.restaurantId).order('created_at', {ascending:false});
        document.getElementById('stockReceiptsBody').innerHTML = (data || []).map(h => `<tr><td>${new Date(h.created_at).toLocaleDateString()}</td><td>${h.material_name}</td><td>${h.qty_received}</td><td>${h.received_by}</td></tr>`).join('');
    };

    window.showPage = async (id) => {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        document.querySelectorAll('nav button').forEach(b => 
            b.classList.toggle('active', b.getAttribute('onclick').includes(id))
        );

        if (id === 'finishedProductsPage' || id === 'salesPage') {
            await loadInventory();
        } else if (id === 'kitchenPage') {
            await loadCurrentShift();
            await loadInventory(); // Gets the items from shift_inventory
            await window.loadProducts();  // Fills the dropdown
            await window.loadKitchenData();
        } else if (id === 'matrixPage') {
            await loadInventory();
            await loadRawMaterials();
            updateDropdowns();     
        } else if (id === 'stocksPage') {
            await loadRawMaterials();
            updateDropdowns();     
        } else if (id === 'storePage') {
            await loadRawMaterials();
        } 
        // ADD THIS SECTION FOR REPORTS
        else if (id === 'reportsPage') {
            const dateInput = document.getElementById('reportDate');
            if (dateInput && !dateInput.value) {
                // Set default to today if no date is picked yet
                dateInput.value = new Date().toISOString().split('T')[0];
            }
            loadShiftReport(); // Trigger the report calculation
        }
    };

    window.updateDropdowns = () => {
        // 1. Kitchen Page dropdown
        const kitSel = document.getElementById('finishedItemSelect');
        if (kitSel) {
            kitSel.innerHTML = '<option value="">-- Select Product --</option>' + 
                state.items.map(i => `<option value="${i.product_id}">${i.name}</option>`).join('');
        }

        // 2. Matrix Page (Finished Item) dropdown
        const matSel = document.getElementById('masterProductSelect');
        if (matSel) {
            matSel.innerHTML = '<option value="">-- Select Product --</option>' + 
                state.items.map(i => `<option value="${i.name}">${i.name}</option>`).join('');
        }

        // 3. Matrix Page (Ingredients) dropdowns
        document.querySelectorAll('.ing-select').forEach(sel => {
            sel.innerHTML = '<option value="">-- Select Ingredient --</option>' + 
                state.rawMaterials.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
        });

        // 4. Stocks Page dropdown
        const recSel = document.getElementById('receiveMaterialSelect');
        if (recSel) {
            recSel.innerHTML = '<option value="">-- Select Material --</option>' + 
                state.rawMaterials.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
        }
    };
        
    window.saveRawMaterial = async () => {
        const btn = document.getElementById('saveRawBtn');
        const id = document.getElementById('rawMaterialId').value;
        const name = document.getElementById('rawName').value;
        const bUnit = document.getElementById('buyUnit').value;
        const sUnit = document.getElementById('storeUnit').value;
        const factor = Number(document.getElementById('convFactor').value) || 1;
        const price = Number(document.getElementById('buyPrice').value) || 0;

        if (!name || price <= 0) {
            return alert("Please enter a Material Name and Price.");
        }

        setLoading(btn, true, "Saving...");

        try {
            const payload = {
                restaurant_id: state.restaurantId,
                name: name,
                buy_unit: bUnit,
                store_unit: sUnit,
                conversion_factor: factor,
                price: price
            };
            const { error } = id
                ? await supabase.from('main_store').update(payload).eq('id', id)
                : await supabase.from('main_store').insert([payload]);

            if (error) throw error;

            alert(id ? "Material Updated!" : "Material Added!");
            
            resetRawForm();
            await loadRawMaterials(); 

        } catch (err) {
            handleError(err, "Save Failed");
        } finally {
            setLoading(btn, false);
        }
    };

    window.resetRawForm = () => {
        document.getElementById('rawMaterialId').value = "";
        document.getElementById('rawName').value = "";
        document.getElementById('buyUnit').value = "";
        document.getElementById('storeUnit').value = "";
        document.getElementById('convFactor').value = "1";
        document.getElementById('buyPrice').value = "";
        document.getElementById('rawFormTitle').innerText = "Add New Raw Material";
        document.getElementById('cancelRawBtn').style.display = "none";
        document.getElementById('saveRawBtn').innerText = "Save Material";
    };
    // Switch between different report types
    window.switchReportView = (view) => {
        // Basic toggle logic
        const isShift = view === 'shift-audit';
        const btnShiftAudit = document.getElementById('btnShiftAudit');
        if (btnShiftAudit) {
            btnShiftAudit.style.background = isShift ? '#7092ae' : '#eee';
            btnShiftAudit.style.color = isShift ? 'white' : '#333';
        }
        
        if (isShift) loadShiftReport();
    };

    window.loadShiftReport = async () => {
        const reportDate = document.getElementById('reportDate').value;
        if (!reportDate) return;

        const tableBody = document.getElementById('shiftTableBody');
        const tableContainer = document.getElementById('shiftTableContainer');
        const detailView = document.getElementById('shiftDetailView');
        
        tableContainer.style.display = 'block';
        detailView.style.display = 'none';
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px;">Fetching shifts...</td></tr>';

        try {
            // Try fetching with the date filter
            const { data: shifts, error } = await supabase
                .from('shifts')
                .select('*')
                .eq('restaurant_id', state.restaurantId)
                .filter('created_at', 'gte', `${reportDate}T00:00:00Z`)
                .filter('created_at', 'lte', `${reportDate}T23:59:59Z`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            if (!shifts || shifts.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:#a0aec0;">No shifts recorded for ${reportDate}</td></tr>`;
                return;
            }

            tableBody.innerHTML = shifts.map(s => {
                // We use "s['column_name']" to safely access the database fields
                const sales = Number(s.total_sales || 0);
                
                // M-Pesa Logic
                const mOpen = Number(s.mpesa_float || s.opening_balance || 0);
                const mClose = Number(s.mpesa_closing || s.closing_balance || 0);
                const mWith = Number(s.mpesa_withdrawals || s.withdrawals || 0);
                const mIncome = mClose + mWith - mOpen;

                // Income & Variance Logic
                const cashIn = Number(s.cash_at_hand || 0);
                const exp = Number(s.total_expenses || 0);
                const dGiven = Number(s.total_debts || 0);
                const dPaid = Number(s.debts_collected || 0);
                
                // Your Formula
                const tIncome = mIncome + cashIn + dGiven + exp - dPaid;
                const variance = tIncome - sales;

                return `
                    <tr style="border-bottom: 1px solid #edf2f7;">
                        <td style="padding:12px;">${new Date(s.created_at).toLocaleDateString()}</td>
                        <td style="padding:12px;">${s.closed_by || 'Staff'}</td>
                        <td style="padding:12px; font-weight:bold;">${sales.toLocaleString()}</td>
                        <td style="padding:12px;">${mIncome.toLocaleString()}</td>
                        <td style="padding:12px; font-weight:bold; color:${variance < 0 ? '#e11d48' : '#166534'};">
                            ${variance.toLocaleString()}
                        </td>
                        <td style="padding:12px;">
                            <button class="btn" onclick="viewShiftDetail('${s.id}')" style="background:#fff; border:1px solid #ccc; padding:4px 10px; border-radius:4px; cursor:pointer;">VIEW</button>
                        </td>
                    </tr>
                `;
            }).join('');
        } catch (err) {
            console.error("Report Load Error:", err);
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#e53e3e; padding:20px;">Error: ${err.message}</td></tr>`;
        }
    };
        
    window.viewShiftDetail = async (shiftId) => {
        const tableContainer = document.getElementById('shiftTableContainer');
        const detailView = document.getElementById('shiftDetailView');
        const detailContent = document.getElementById('shiftDetailContent');

        tableContainer.style.display = 'none';
        detailView.style.display = 'block';
        detailContent.innerHTML = '<p style="text-align:center;">Calculating Reconciliation...</p>';

        try {
            const { data: s, error } = await supabase.from('shifts').select('*').eq('id', shiftId).single();
            if (error) throw error;

            // --- 1. DEFINE ALL VARIABLES FROM DATABASE ---
            const totalSales = Number(s.total_sales || 0);
            const mOpening = Number(s.mpesa_float || 0);
            const mClosing = Number(s.mpesa_closing || 0); // This was likely the missing one
            const mWithdrawals = Number(s.mpesa_withdrawals || 0);
            const cashIn = Number(s.cash_at_hand || 0);
            const expenses = Number(s.total_expenses || 0);
            const debtGiven = Number(s.total_debts || 0);
            const debtsPaid = Number(s.debts_collected || 0);

            // --- 2. APPLY YOUR FORMULAS ---
            // Mpesa Income = Closing Balance + Withdrawals - Opening Balance
            const mIncome = mClosing + mWithdrawals - mOpening;

            // Total Income = Mpesa Income + Cash In + Debt Given + Expenses - Debts Paid
            const totalIncome = mIncome + cashIn + debtGiven + expenses - debtsPaid;

            // Variance = Total Income - Total Sales
            const variance = totalIncome - totalSales;

            // --- 3. RENDER THE VIEW ---
            detailContent.innerHTML = `
                <div style="background:white; padding:20px; border-radius:8px; border:1px solid #e2e8f0; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:10px;">
                        <h3 style="margin:0;">Shift Reconciliation</h3>
                        <span style="color:#64748b; font-size:12px;">Ref: ${s.id.slice(0,8)}</span>
                    </div>

                    <div style="background:#f8fafc; padding:15px; border-radius:8px; margin-bottom:20px;">
                        <div style="color:#7092ae; font-weight:bold; font-size:12px; margin-bottom:10px;">M-PESA CALCULATION</div>
                        <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:5px;">
                            <span>Closing Balance + Withdrawals:</span>
                            <span>${(mClosing + mWithdrawals).toLocaleString()}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:14px; border-bottom:1px solid #cbd5e0; padding-bottom:5px; margin-bottom:5px;">
                            <span>Less Opening Balance:</span>
                            <span>- ${mOpening.toLocaleString()}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-weight:bold;">
                            <span>M-Pesa Income:</span>
                            <span>Ksh ${mIncome.toLocaleString()}</span>
                        </div>
                    </div>

                    <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
                        <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;">M-Pesa Income</td><td style="text-align:right;">+ ${mIncome.toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;">Cash at Hand (In)</td><td style="text-align:right;">+ ${cashIn.toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;">New Debt Given</td><td style="text-align:right;">+ ${debtGiven.toLocaleString()}</td></tr>
                        <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:10px 0;">Expenses Paid</td><td style="text-align:right;">+ ${expenses.toLocaleString()}</td></tr>
                        <tr style="border-bottom:2px solid #2d3748;"><td style="padding:10px 0; color:#e11d48;">Less: Prev. Debts Paid</td><td style="text-align:right; color:#e11d48;">- ${debtsPaid.toLocaleString()}</td></tr>
                        
                        <tr style="background:#f1f5f9; font-weight:bold; font-size:1.1em;">
                            <td style="padding:12px;">TOTAL ACCOUNTED INCOME</td>
                            <td style="text-align:right;">Ksh ${totalIncome.toLocaleString()}</td>
                        </tr>
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:12px;">SYSTEM TOTAL SALES</td>
                            <td style="text-align:right;">Ksh ${totalSales.toLocaleString()}</td>
                        </tr>
                        <tr style="background:${variance < 0 ? '#fff1f2' : '#f0fdf4'}; color:${variance < 0 ? '#e11d48' : '#166534'};">
                            <td style="padding:12px; font-weight:bold;">VARIANCE</td>
                            <td style="text-align:right; font-weight:bold;">Ksh ${variance.toLocaleString()}</td>
                        </tr>
                    </table>
                </div>
            `;
        } catch (err) {
            console.error(err);
            detailContent.innerHTML = `<p style="color:red; text-align:center;">Error: ${err.message}</p>`;
        }
    };
        
    window.exportReportPDF = () => {
        const element = document.getElementById('shiftAuditContent');
        if (!element) {
            alert("Nothing to export yet.");
            return;
        }
        const date = document.getElementById('reportDate').value;
        const opt = {
            margin: 10,
            filename: `Shift_Report_${date}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(element).save();
    };  
    
    window.backToShiftTable = () => {
        document.getElementById('shiftTableContainer').style.display = 'block';
        document.getElementById('shiftDetailView').style.display = 'none';
        };

    window.getOpeningBalances = async () => {
        try {
            // Fetch the single most recent shift for this restaurant
            const { data, error } = await supabase
                .from('shifts')
                .select('mpesa_closing, cash_at_hand')
                .eq('restaurant_id', state.restaurantId)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 just means no rows found (first shift ever)
                console.error("Error fetching previous balances:", error);
                return { mpesa: 0, cash: 0 };
            }

            return {
                mpesa: data ? Number(data.mpesa_closing || 0) : 0,
                cash: data ? Number(data.cash_at_hand || 0) : 0
            };
        } catch (err) {
            console.error(err);
            return { mpesa: 0, cash: 0 };
        }
    };       

    window.editRawMaterial = (id) => {
        const material = state.rawMaterials.find(item => item.id === id);
        if (!material) return;

        document.getElementById('rawMaterialId').value = material.id;
        document.getElementById('rawName').value = material.name || '';
        document.getElementById('buyUnit').value = material.buy_unit || '';
        document.getElementById('storeUnit').value = material.store_unit || '';
        document.getElementById('convFactor').value = material.conversion_factor || 1;
        document.getElementById('buyPrice').value = material.price || '';
        document.getElementById('rawFormTitle').innerText = "Edit Raw Material";
        document.getElementById('cancelRawBtn').style.display = "inline-block";
        document.getElementById('saveRawBtn').innerText = "Update Material";
    };

    window.deleteRecipe = async (id) => {
        if (!confirm("Delete this recipe line?")) return;

        const { error } = await supabase.from('recipes').delete().eq('id', id);
        if (error) {
            handleError(error, "Failed to delete recipe");
            return;
        }

        await loadRecipes();
    };

    window.loadExistingRecipe = (productName) => {
        for (let i = 1; i <= 3; i++) {
            document.getElementById(`ing${i}`).value = '';
            document.getElementById(`qty${i}`).value = '';
        }

        if (!productName) return;

        const rows = state.recipeMatrix
            .filter(recipe => recipe.finished_item_name === productName)
            .slice(0, 3);

        rows.forEach((recipe, index) => {
            const rowNo = index + 1;
            document.getElementById(`ing${rowNo}`).value = recipe.material_name || '';
            document.getElementById(`qty${rowNo}`).value = Number(recipe.qty_per_unit || 0);
        });
    };

    window.updateItemField = (id, field, value) => {
        const item = state.items.find(entry => entry.id === id);
        if (!item) return;
        item[field] = Number(value) || 0;
    };

    const postBtn = document.getElementById('postBtn');
    if (postBtn) {
        postBtn.addEventListener('click', window.processReverseDispatch);
    }

   window.handleLogout = () => { supabase.auth.signOut(); location.reload(); };


