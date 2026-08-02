/**
 * «התחבר עם…» — מריץ את זרימת ה-OAuth ושומר את התוצאה במקום שבו שאר
 * המערכת כבר מצפה למצוא אותה. מנקודת מבטם של github.ts / vercel.ts /
 * supabase.ts שום דבר לא השתנה: יש טוקן מוצפן במחשב, רק שהמשתמש לא
 * הדביק אותו ביד.
 */
import { saveSettings } from '../storage'
import { setGithubToken } from '../secrets'
import { validateGithubToken } from './github'
import { runOAuthFlow, PROVIDER_LABELS, type OAuthProvider } from './oauth'
import { saveSupabaseOAuth } from './supabase_account'
import { setVercelUserToken, validateVercelToken } from './vercel'

export interface OAuthConnectResult {
  provider: OAuthProvider
  /** שם החשבון/הארגון להצגה. ריק אם הספק לא מספק אותו. */
  account?: string
  message: string
}

export async function connectProviderWithOAuth(
  provider: OAuthProvider
): Promise<OAuthConnectResult> {
  const tokens = await runOAuthFlow(provider)
  const label = PROVIDER_LABELS[provider]

  switch (provider) {
    case 'github': {
      // מאמתים לפני שמירה — טוקן שנשמר ונכשל אחר כך מייצר תקלה עמומה
      const user = await validateGithubToken(tokens.accessToken)
      setGithubToken(tokens.accessToken)
      return {
        provider,
        account: user.login,
        message: `${label} חובר: @${user.login}`
      }
    }

    case 'vercel': {
      const user = await validateVercelToken(tokens.accessToken)
      setVercelUserToken(tokens.accessToken)
      // בחשבון צוותי כל קריאה ל-API חייבת לשאת teamId, אחרת Vercel מחזיר 403.
      // חשבון אישי מחזיר null — ואז מנקים מזהה צוות ישן שנשאר מחיבור קודם.
      const teamId = typeof tokens.extra?.team_id === 'string' ? tokens.extra.team_id : ''
      saveSettings({ vercelTeamId: teamId })
      return {
        provider,
        account: user.username,
        message: `${label} חובר: ${user.username}`
      }
    }

    case 'supabase': {
      const { orgName } = await saveSupabaseOAuth(tokens)
      return {
        provider,
        account: orgName,
        message: orgName ? `${label} חובר: ${orgName}` : `${label} חובר`
      }
    }
  }
}
