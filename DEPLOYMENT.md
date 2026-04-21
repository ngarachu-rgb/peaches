# GitHub / Vercel Deployment

This app is a static frontend that connects directly to Supabase.

## What you need

- A GitHub account
- A Vercel account
- Access to the current Supabase project

## 1. Push this folder to GitHub

From `C:\POS SYSTEM`:

```powershell
git init
git add .
git commit -m "Prepare POS app for deployment"
```

Then create a GitHub repository and push:

```powershell
git remote add origin <YOUR_GITHUB_REPO_URL>
git branch -M main
git push -u origin main
```

## 2. Deploy on Vercel

1. Log in to Vercel.
2. Click `Add New...` -> `Project`.
3. Import the GitHub repository.
4. When asked for framework, choose `Other`.
5. Leave build command empty.
6. Leave output directory empty.
7. Deploy.

## 3. Staff login address

After deploy, Vercel gives you a URL like:

- `https://your-project-name.vercel.app`

That becomes the remote login address for staff.

## 4. After first deploy

Check these from another computer:

- login works
- branch isolation works
- shift status loads
- stock receipts work
- Bar issue-to-shots works
- reports load

## 5. Important note

This project currently uses the Supabase URL and anon key directly in:

- [js/config.js](/c:/POS%20SYSTEM/js/config.js:1)

That is acceptable for a frontend app using the anon key, but do not put any service-role keys in the frontend.

## 6. Recommended launch path

Use the hosted Vercel URL for staff and keep the first launch controlled:

- trusted users first
- a few supervised shifts
- then expand usage
