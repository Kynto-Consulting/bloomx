import type { DocPageContent } from './types';
import intro from './pages/index';
import architecture from './pages/architecture';
import gettingStarted from './pages/getting-started';
import envVariables from './pages/env-variables';
import deployment from './pages/deployment';
import emailSetup from './pages/email-setup';
import themes from './pages/themes';
import landing from './pages/landing';
import hideDocs from './pages/hide-docs';
import features from './pages/features';
import elixir from './pages/elixir';
import sealer from './pages/sealer';
import ai from './pages/ai';
import storage from './pages/storage';
import security from './pages/security';
import compliance from './pages/compliance';
import oauthProviders from './pages/oauth-providers';
import marketplace from './pages/marketplace';
import marketplaceMetadata from './pages/marketplace-metadata';
import expansions from './pages/expansions';
import createExtension from './pages/create-extension';
import extensionUi from './pages/extension-ui';
import extensionPages from './pages/extension-pages';
import extensionTools from './pages/extension-tools';
import extensionTsdocs from './pages/extension-tsdocs';
import api from './pages/api';
import apiBackend from './pages/api-backend';
import operations from './pages/operations';
import faq from './pages/faq';
import adminConsole from './pages/admin-console';
import conferencing from './pages/conferencing';
import mailTransfer from './pages/mail-transfer';
import spam from './pages/spam';
import adminCli from './pages/admin-cli';
import developerGuide from './pages/developer-guide';
import billingGuide from './pages/billing-guide';
import billingSetup from './pages/billing-setup';
import paymentsSecurity from './pages/payments-security';

/** slug ('' = /docs) -> contenido es/en. Debe tener una entrada por cada pagina de DOC_NAV (lo comprueba el test). */
export const DOC_CONTENT: Record<string, DocPageContent> = {
    '': intro,
    architecture,
    'getting-started': gettingStarted,
    'env-variables': envVariables,
    deployment,
    'email-setup': emailSetup,
    themes,
    landing,
    'hide-docs': hideDocs,
    features,
    elixir,
    sealer,
    ai,
    storage,
    security,
    compliance,
    'oauth-providers': oauthProviders,
    marketplace,
    'marketplace-metadata': marketplaceMetadata,
    expansions,
    'create-extension': createExtension,
    'extension-pages': extensionPages,
    'extension-ui': extensionUi,
    'extension-tools': extensionTools,
    'extension-tools/tsdocs': extensionTsdocs,
    api,
    'api-backend': apiBackend,
    operations,
    faq,
    admin: adminConsole,
    conferencing,
    'mail-transfer': mailTransfer,
    spam,
    'admin-cli': adminCli,
    'developer-guide': developerGuide,
    'billing-guide': billingGuide,
    'billing-setup': billingSetup,
    'payments-security': paymentsSecurity,
};
