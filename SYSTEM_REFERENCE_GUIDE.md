# System Reference Guide

## Purpose
This document explains how the POS and shift management system works at a practical and technical level.

It is intended for future reference when you need to understand:
- how the app is structured
- which files do what
- how Supabase fits in
- how Git fits in
- how Vercel fits in

## 1. Overall Architecture
The system has 4 main parts:

1. Frontend app
- Runs in the browser
- Built with `index.html` and JavaScript files in `js/`
- This is what staff use

2. Supabase backend
- Stores the live business data
- Holds users, branches, shifts, stock, recipes, receipts, transfers, issues, expenses, debts, reports data
- Acts as the source of truth

3. Git / GitHub
- Stores the code history
- Lets you save changes safely
- Feeds Vercel deployments

4. Vercel
- Hosts the frontend app online
- Gives staff the remote login URL
- Automatically redeploys after `git push`

## 2. How the App Works
At a high level:

1. User opens the Vercel-hosted site
2. User logs in
3. App reads user profile and branch context from Supabase
4. App loads branch-specific stock, products, shift, and permissions
5. User performs operations such as:
- receive stock
- post kitchen output
- record sales
- issue bar stock to shots
- reconcile finance
- close shift
6. App writes all changes back to Supabase

## 3. Key Files

### Main frontend entry
- [index.html](/c:/POS%20SYSTEM/index.html:1)

Role:
- main UI layout
- page sections
- styling
- navigation
- shared HTML elements

This file defines the visible screens such as:
- Daily Sales
- Kitchen Ops
- Finished Products
- Reports & Audit
- Store Stocks
- Raw Items List
- Inventory Matrix
- My Account

### Main app controller
- [js/app.js](/c:/POS%20SYSTEM/js/app.js:1)

Role:
- connects UI actions to business logic
- renders tables and forms
- loads data into pages
- handles button clicks
- controls page switching
- calculates displayed totals

This is the largest operational file and acts like the main browser-side coordinator.

### State container
- [js/state.js](/c:/POS%20SYSTEM/js/state.js:1)

Role:
- stores current logged-in context
- stores active branch
- stores operating mode
- stores loaded products, raw materials, recipes, shifts, receipts, transfers, issues

Examples of state held here:
- current user
- current branch
- permissions
- current shift
- loaded stock data

### Permissions and roles
- [js/permissions.js](/c:/POS%20SYSTEM/js/permissions.js:1)

Role:
- defines roles
- defines permissions
- maps roles to permissions
- controls which pages/actions each role can access

Examples:
- manager
- supervisor
- cashier
- chef

### Calculation helpers
- [js/calculations.js](/c:/POS%20SYSTEM/js/calculations.js:1)

Role:
- shift math
- sold quantity formula
- M-Pesa calculations
- variance calculations
- next-shift seeding logic

### Database access layer
- [js/repositories.js](/c:/POS%20SYSTEM/js/repositories.js:1)

Role:
- all structured Supabase reads/writes
- wraps table access in reusable functions
- keeps UI logic separate from database logic
- applies restaurant and branch scoping

This is the main data-access layer.

Examples of things it handles:
- products
- raw materials
- shifts
- shift inventory
- stock receipts
- stock transfers
- bar stock issues
- expenses
- debts

### Shift close / open business logic
- [js/shift-service.js](/c:/POS%20SYSTEM/js/shift-service.js:1)

Role:
- opening shifts
- closing shifts
- carry-forward logic
- direct-sales branch close logic
- restaurant production close logic

This file is critical because it controls:
- next shift opening stock
- next shift cash / M-Pesa carry-forward
- saved historical shift totals

### Branch transfer logic
- [js/transfer-service.js](/c:/POS%20SYSTEM/js/transfer-service.js:1)

Role:
- transfers raw/store stock between branches
- validates source stock
- creates destination material if needed
- records transfer history

### Supabase config
- [js/config.js](/c:/POS%20SYSTEM/js/config.js:1)

Role:
- sets the Supabase project URL
- sets the anon key
- creates the browser Supabase client
- builds login email aliases from usernames

Important:
- this frontend uses the Supabase **anon key**
- never place a service-role key in frontend code

## 4. Main Business Data Areas

### Products
Stored in:
- `inventory`

Role:
- finished products sold to customers

Examples:
- restaurant dishes
- bottled drinks
- shots
- glasses

### Raw materials / store stock
Stored in:
- `main_store`

Role:
- branch-level store stock
- raw materials
- unopened bottles
- cans
- restaurant ingredients

### Recipes / inventory matrix
Stored in:
- `recipes`

Role:
- links finished products to stock source items
- supports kitchen recipes
- supports bar measured items

Examples:
- food ingredient usage
- `30ML` shot deductions
- wine glass conversion

### Shift records
Stored in:
- `shifts`
- `shift_inventory`

Role:
- daily/shift operational snapshot
- opening
- added
- closing
- sold
- line totals

### Receipts / transfers / issues
Stored in:
- `stock_receipts`
- `stock_transfers`
- `bar_stock_issues`

Role:
- stock movement audit trail

## 5. Restaurant vs Bar Logic

### Restaurant branches
Mode:
- `FOOD_PRODUCTION`

Typical flow:
1. receive raw materials
2. kitchen produces finished items
3. sales are recorded
4. finance reconciliation
5. shift close

### Bar branches
Mode:
- `DIRECT_SALES`

Typical flow:
1. receive drinks
2. issue bottles/boxes to shots or glasses where needed
3. direct sale of cans/bottles
4. measured sales from issued stock
5. finance reconciliation
6. shift close

## 6. Role of Supabase
Supabase is the live backend and source of truth.

It is responsible for:
- storing all business records
- authenticating users
- saving and retrieving shifts
- saving stock movements
- saving receipts, transfers, issues, expenses, and debts
- powering reports

Why Supabase matters:
- if data is not written to Supabase, it is not part of the real system
- the browser app is only the interface
- Supabase holds the real records

In this project, Supabase is used for:
- Auth
- Postgres database
- browser-side queries through the Supabase JS client

## 7. Role of Git and GitHub
Git is the version-control system.

It is used to:
- track code changes
- save working versions
- make deployment updates
- rollback or inspect history if needed

Common workflow:
```powershell
git add .
git commit -m "Describe the change"
git push
```

GitHub is the remote repository.

It is used to:
- store the project online
- back up the code
- connect the codebase to Vercel

## 8. Role of Vercel
Vercel hosts the frontend app online.

Role:
- serves the app to remote users
- provides the staff login URL
- redeploys the app when GitHub receives new commits

Typical flow:
1. make local code change
2. `git commit`
3. `git push`
4. Vercel redeploys
5. users refresh the live app

Vercel does not hold the business data.
Supabase does.

## 9. SQL Folder
- [sql](/c:/POS%20SYSTEM/sql:1)

Role:
- one-time setup scripts
- schema changes
- validation scripts
- startup/reset scripts
- branch setup scripts

Examples in this folder:
- branch setup
- permissions setup
- stock transfer setup
- bar issue setup
- startup reset scripts
- validation checks

Important principle:
- SQL scripts are often **operational/migration tools**
- they are not part of daily user workflow

## 10. CSV Folder
- [csv](/c:/POS%20SYSTEM/csv:1)

Role:
- starter imports
- bulk setup
- price updates
- stock master preparation

Used for:
- raw material imports
- finished product imports
- recipe matrix imports
- price update batches

## 11. Deployment Files

### Vercel config
- [vercel.json](/c:/POS%20SYSTEM/vercel.json:1)

Role:
- tells Vercel how to serve the app

### Deployment guide
- [DEPLOYMENT.md](/c:/POS%20SYSTEM/DEPLOYMENT.md:1)

Role:
- explains GitHub + Vercel deployment steps

## 12. Operational Principles

### Branch isolation
Every live record must belong to a branch where applicable.

The app uses branch context so:
- `Peaches`
- `Cafe-Li`
- `Peaches Bar`
- `Cafe-Li Bar`

can operate separately.

### Shift carry-forward
Previous shift values feed the next shift:
- stock closing becomes next opening
- cash carried forward becomes next opening cash
- M-Pesa closing becomes next opening float where applicable

### Shift close
At close:
- inventory rows are saved
- finance totals are saved
- shift totals are locked into historical records
- next shift can then open from that state

## 13. What to Be Careful With

1. Do not edit live database data casually.
Startup SQL is different from normal daily operations.

2. Do not confuse:
- browser display
- saved database truth

3. After code changes:
- push to GitHub
- let Vercel redeploy
- refresh the live app

4. When debugging reports or recall:
- check whether values are coming from:
  - saved shift totals
  - saved shift inventory rows
  - current product prices
  - fallback reconstruction logic

5. For bar:
- direct-store sales and issued measured sales are not the same flow

## 14. Recommended Reading Order
If someone new needs to understand the system, read in this order:

1. [index.html](/c:/POS%20SYSTEM/index.html:1)
2. [js/app.js](/c:/POS%20SYSTEM/js/app.js:1)
3. [js/state.js](/c:/POS%20SYSTEM/js/state.js:1)
4. [js/permissions.js](/c:/POS%20SYSTEM/js/permissions.js:1)
5. [js/repositories.js](/c:/POS%20SYSTEM/js/repositories.js:1)
6. [js/shift-service.js](/c:/POS%20SYSTEM/js/shift-service.js:1)
7. [js/transfer-service.js](/c:/POS%20SYSTEM/js/transfer-service.js:1)
8. [DEPLOYMENT.md](/c:/POS%20SYSTEM/DEPLOYMENT.md:1)
9. relevant files in [sql](/c:/POS%20SYSTEM/sql:1)

## 15. Short Summary
In simple terms:

- `index.html` = screens
- `app.js` = browser behavior
- `state.js` = current session memory
- `permissions.js` = who can do what
- `repositories.js` = database reads/writes
- `shift-service.js` = opening/closing shift rules
- `transfer-service.js` = branch stock transfer rules
- `Supabase` = live backend and source of truth
- `Git/GitHub` = version history and code transport
- `Vercel` = live app hosting

