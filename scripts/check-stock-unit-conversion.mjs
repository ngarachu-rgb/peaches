import assert from 'node:assert/strict';
import { buildStockUnitConversionPlan } from '../js/calculations.js';

const mlToBottle = buildStockUnitConversionPlan({
    currentStock: 1500,
    oldBuyUnit: 'Bottle',
    oldStoreUnit: 'ML',
    oldConversionFactor: 250,
    newBuyUnit: 'Bottle',
    newStoreUnit: 'Bottle',
    newConversionFactor: 1
});
assert.equal(mlToBottle.convertedStock, 6);
assert.equal(mlToBottle.storeUnitChanged, true);

const correctedFactor = buildStockUnitConversionPlan({
    currentStock: 5,
    oldBuyUnit: 'Bottle',
    oldStoreUnit: 'Bottle',
    oldConversionFactor: 250,
    newBuyUnit: 'Bottle',
    newStoreUnit: 'Bottle',
    newConversionFactor: 1
});
assert.equal(correctedFactor.convertedStock, 5);
assert.equal(correctedFactor.storeUnitChanged, false);

assert.throws(
    () => buildStockUnitConversionPlan({
        currentStock: 5,
        oldBuyUnit: 'Bottle',
        oldStoreUnit: 'Bottle',
        oldConversionFactor: 1,
        newBuyUnit: 'Bottle',
        newStoreUnit: 'Bottle',
        newConversionFactor: 250
    }),
    /must be 1/
);

assert.throws(
    () => buildStockUnitConversionPlan({
        currentStock: 5,
        oldBuyUnit: 'Bottle',
        oldStoreUnit: 'ML',
        oldConversionFactor: 250,
        newBuyUnit: 'Case',
        newStoreUnit: 'Bottle',
        newConversionFactor: 12
    }),
    /cannot both be changed/
);

console.log('Stock unit conversion checks passed.');
