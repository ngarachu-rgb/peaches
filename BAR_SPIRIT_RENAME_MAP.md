# Bar Spirit Rename Map

This is the proposed final normalization for spirit-related rows from your current Bar sheet.

## Rules Applied

- bottle stock names always include size
- full-bottle sale names match stock names
- measured sale names use `Brand + 30ML`
- `750ML` is the default source bottle for measured sales where both `750ML` and `1000ML` exist
- ambiguous bottle names without size were normalized to explicit sizes where possible

## Rename / Keep Map

| Current Name | Current Sale Type | Proposed Final Name | Notes |
| --- | --- | --- | --- |
| BEST GIN 250ML | bottle | BEST GIN 250ML | Keep |
| BEST GIN 750 ML | bottle | BEST GIN 750ML | Normalize spacing |
| BEST GIN | 30 ML | BEST GIN 30ML | Measured sale |
| BEST VODKA 750ML | bottle | BEST VODKA 750ML | Keep |
| BEST VODKA | 30 ML | BEST VODKA 30ML | Measured sale |
| BEST WHYSKEY 250ML | bottle | BEST WHISKY 250ML | Correct spelling |
| Best Whiskey 750ML | bottle | BEST WHISKY 750ML | Standardize case/spelling |
| Best Whiskey | 30 ML | BEST WHISKY 30ML | Standardize case/spelling |
| BLACK AND WHITE | bottle | REMOVE | Ambiguous plain row; use sized rows instead |
| Black & White 750ML | bottle | BLACK & WHITE 750ML | Keep |
| Black & White 1000ML | bottle | BLACK & WHITE 1000ML | Keep |
| Black & White | 30 ML | BLACK & WHITE 30ML | Measured sale |
| Black Label 1000ML | bottle | BLACK LABEL 1000ML | Standardize case |
| Black Label | 30 ML | BLACK LABEL 30ML | Measured sale |
| CHROME GIN 250ML | bottle | CHROME GIN 250ML | Keep |
| KIBAO VODKA 250ML | bottle | KIBAO VODKA 250ML | Keep |
| CAPTAIN MORGAN GOLD 250ML | bottle | CAPTAIN MORGAN GOLD 250ML | Keep |
| Captain Morgan Gold | bottle | CAPTAIN MORGAN GOLD 750ML | Assumed 750ML stock row |
| Captain Morgan Gold | 30 ML | CAPTAIN MORGAN GOLD 30ML | Measured sale |
| Captain Morgan Spice | bottle | CAPTAIN MORGAN SPICE 750ML | Assumed 750ML stock row |
| Captain Morgan Spice | 30 ML | CAPTAIN MORGAN SPICE 30ML | Measured sale |
| KONYAGI 250ML | bottle | KONYAGI 250ML | Keep |
| Konyagi 750ML | bottle | KONYAGI 750ML | Standardize case |
| Konyagi | 30 ML | KONYAGI 30ML | Measured sale |
| SMIRNOFF VODKA 350ML | bottle | SMIRNOFF VODKA 350ML | Keep |
| Smirnorf 750 | bottle | SMIRNOFF VODKA 750ML | Normalize spelling and size |
| SMIRNORF VODKA 1000ML | bottle | SMIRNOFF VODKA 1000ML | Normalize spelling |
| SMIRNORF VODKA | 30 ML | SMIRNOFF VODKA 30ML | Normalize spelling |
| CAMINO CLEAR 750ML | bottle | CAMINO CLEAR 750ML | Keep |
| CAMINO CLEAR | 30 ML | CAMINO CLEAR 30ML | Measured sale |
| COUNTY 750ML | bottle | COUNTY 750ML | Keep |
| COUNTY | 30 ML | COUNTY 30ML | Measured sale |
| Gilbeys 750 | bottle | GILBEYS GIN 750ML | Clarify brand/type |
| Gilbeys GIN | 30 ML | GILBEYS GIN 30ML | Measured sale |
| Gordon 1L | bottle | GORDON'S GIN 1000ML | Normalize brand and size |
| Gordons gin 750 | bottle | GORDON'S GIN 750ML | Normalize brand and size |
| Gordons gin 750 | 30 ML | GORDON'S GIN 30ML | Measured sale; uses 750ML source |
| Hennesey 1000ML | bottle | HENNESSY 1000ML | Correct spelling |
| Humpton | bottle | HUMPTON 750ML | Assumed 750ML stock row |
| HUNTERS CHOICE 750ML | bottle | HUNTERS CHOICE 750ML | Keep |
| HUNTERS CHOICE | 30 ML | HUNTERS CHOICE 30ML | Measured sale |
| JACK DANIELS 1000ML | bottle | JACK DANIELS 1000ML | Keep |
| JACK DANIELS 700ML | bottle | JACK DANIELS 700ML | Keep |
| JACK DANIELS | 30 ML | JACK DANIELS 30ML | Measured sale; uses 700ML source |
| Jagermefter | bottle | REMOVE | Duplicate ambiguous row |
| Jagermefter 750 ml | bottle | JAGERMEISTER 750ML | Normalize brand/spelling |
| Jagermefter | 30 ML | JAGERMEISTER 30ML | Normalize brand/spelling |
| JAMESON 1000ML | bottle | JAMESON 1000ML | Keep |
| JAMESON | 30 ML | JAMESON 30ML | Measured sale |
| JOHN BARR | bottle | JOHN BARR 750ML | Assumed 750ML stock row |
| JOHN BARR | 30 ML | JOHN BARR 30ML | Measured sale |
| Jose Q Gold 1000ML | bottle | JOSE CUERVO GOLD 1000ML | Normalize brand naming |
| Jose Q Gold 750ML | bottle | JOSE CUERVO GOLD 750ML | Normalize brand naming |
| Jose Q Gold | 30 ML | JOSE CUERVO GOLD 30ML | Measured sale |
| Jose Q silver | bottle | JOSE CUERVO SILVER 750ML | Assumed 750ML stock row |
| Jose Q silver | 30 ML | JOSE CUERVO SILVER 30ML | Measured sale |
| KENYA CANE SMOOTH 750ML | bottle | KENYA CANE SMOOTH 750ML | Keep |
| KENYA CANE SMOOTH | 30 ML | KENYA CANE SMOOTH 30ML | Measured sale |
| Malibu | bottle | MALIBU 750ML | Assumed 750ML stock row |
| Malibu | 30 ML | MALIBU 30ML | Measured sale |
| Martell | bottle | MARTELL 750ML | Assumed 750ML stock row |
| Martell | 30 ML | MARTELL 30ML | Measured sale |
| Red Label 1l | bottle | RED LABEL 1000ML | Normalize size |
| Red Label WHYSKEY | 30 ML | RED LABEL 30ML | Standardize spelling and measured sale naming |
| sheridans | bottle | SHERIDAN'S 750ML | Assumed 750ML stock row |
| sheridans | 30 ML | SHERIDAN'S 30ML | Measured sale |
| TANQUAERAY 1L | bottle | TANQUERAY 1000ML | Correct spelling and size |
| TANQUAERAY | 30 ML | TANQUERAY 30ML | Correct spelling |

## Wine Mapping

| Current Name | Proposed Stock Source | Proposed Measured Sale |
| --- | --- | --- |
| Red Dry Wine | RED DRY WINE BOTTLE 750ML | RED DRY WINE 150ML |
| Red Sweet wine | RED SWEET WINE BOTTLE 750ML | RED SWEET WINE 150ML |
| WHITE DRY Wine | WHITE DRY WINE BOTTLE 750ML | WHITE DRY WINE 150ML |
| WHITE SWEET WINE | WHITE SWEET WINE BOTTLE 750ML | WHITE SWEET WINE 150ML |

## Assumptions To Confirm

These were assumed as `750ML` because your sheet did not show size:

- CAPTAIN MORGAN GOLD 750ML
- CAPTAIN MORGAN SPICE 750ML
- HUMPTON 750ML
- JOHN BARR 750ML
- JOSE CUERVO SILVER 750ML
- MALIBU 750ML
- MARTELL 750ML
- SHERIDAN'S 750ML

If any of those are actually `1000ML`, update them before import.
