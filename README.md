# maxteeple.com

## LiveView admin

Demo fan and course accounts are not admins. To approve streams, load demo data again, or reset a password, set a Worker secret on the free plan (no payment method):

```
npx wrangler secret put ADMIN_APPROVAL_TOKEN
```

Open https://maxteeple.com/liveview/admin.html and paste that token. It is not stored in git. If the secret is unset, the Worker keeps a random admin token in D1 and does not return it. There is no public admin password, and an account cannot promote itself.
