// Felismerési minták. A kulcs a megjelenítendő név; html: forráskód-regex, ns: REST-névtér, slug: plugin/téma slug.
export const BUILDERS = [
  { name: 'Elementor', slug: 'elementor', html: /elementor/i },
  { name: 'Elementor Pro', slug: 'elementor-pro', html: /elementor-pro/i },
  { name: 'Divi', theme: 'Divi', html: /et_pb_|\/themes\/Divi\/|et-builder/i },
  { name: 'Divi Builder (plugin)', slug: 'divi-builder', html: /\/plugins\/divi-builder\//i },
  { name: 'WPBakery', slug: 'js_composer', html: /js_composer|vc_row/i },
  { name: 'Beaver Builder', slug: 'bb-plugin', html: /fl-builder|bb-plugin/i },
  { name: 'Oxygen', slug: 'oxygen', html: /oxygen-|ct-section/i },
  { name: 'Bricks', theme: 'bricks', html: /\/themes\/bricks\/|brxe-/i },
  { name: 'Breakdance', slug: 'breakdance', html: /breakdance/i },
  { name: 'Avada / Fusion', theme: 'Avada', html: /fusion-builder|\/themes\/Avada\//i },
  { name: 'Enfold', theme: 'enfold', html: /\/themes\/enfold\//i },
  { name: 'Kadence Blocks', slug: 'kadence-blocks', html: /kadence-blocks|kb-row-layout/i },
  { name: 'Spectra', slug: 'ultimate-addons-for-gutenberg', html: /uagb-/i },
  { name: 'GenerateBlocks', slug: 'generateblocks', html: /gb-container|generateblocks/i },
];
export const SEO = [
  { name: 'Yoast SEO', slug: 'wordpress-seo', ns: 'yoast/v1', html: /yoast-schema-graph|This site is optimized with the Yoast/i },
  { name: 'Yoast SEO Premium', slug: 'wordpress-seo-premium', html: /Yoast SEO Premium/i },
  { name: 'Rank Math', slug: 'seo-by-rank-math', ns: 'rankmath/v1', html: /rank-math|Rank Math/i },
  { name: 'SEOPress', slug: 'wp-seopress', ns: 'seopress/v1', html: /seopress/i },
  { name: 'All in One SEO', slug: 'all-in-one-seo-pack', ns: 'aioseo/v1', html: /aioseo/i },
  { name: 'The SEO Framework', slug: 'autodescription', html: /The SEO Framework/i },
  { name: 'Slim SEO', slug: 'slim-seo', html: /slim-seo/i },
];
export const SECURITY = [
  { name: 'Wordfence', slug: 'wordfence', ns: 'wordfence/v1', html: /wordfence/i },
  { name: 'Solid / iThemes Security', slug: 'better-wp-security', ns: 'ithemes-security/v1', html: /ithemes-security|solid-security/i },
  { name: 'Kadence Security', slug: 'kadence-security', html: /kadence-security/i },
  { name: 'Sucuri', slug: 'sucuri-scanner', html: /sucuri/i },
  { name: 'All-In-One Security', slug: 'all-in-one-wp-security-and-firewall', ns: 'aios/v1', html: /aiowps/i },
  { name: 'Shield Security', slug: 'wp-simple-firewall', html: /shield-security|icwp-wpsf/i },
  { name: 'WP Cerber', slug: 'wp-cerber', html: /wp-cerber/i },
];
export const CACHE = [
  { name: 'WP Rocket', slug: 'wp-rocket', html: /This website is like a Rocket|wp-rocket/i },
  { name: 'LiteSpeed Cache', slug: 'litespeed-cache', ns: 'litespeed/v1', html: /litespeed/i, header: 'x-litespeed-cache' },
  { name: 'W3 Total Cache', slug: 'w3-total-cache', html: /W3 Total Cache/i },
  { name: 'WP Super Cache', slug: 'wp-super-cache', html: /WP-Super-Cache|wp-super-cache/i },
  { name: 'WP Fastest Cache', slug: 'wp-fastest-cache', html: /WP Fastest Cache/i },
  { name: 'Autoptimize', slug: 'autoptimize', html: /autoptimize/i },
  { name: 'WP-Optimize', slug: 'wp-optimize', html: /WP-Optimize|wpo_min/i },
  { name: 'SiteGround Optimizer', slug: 'sg-cachepress', html: /sg-cachepress|siteground-optimizer/i },
  { name: 'Hummingbird', slug: 'hummingbird-performance', html: /hummingbird/i },
  { name: 'FlyingPress', slug: 'flying-press', html: /flying-press/i },
];
export const COOKIE = [
  { name: 'Complianz', slug: 'complianz-gdpr', ns: 'complianz/v1', html: /cmplz/i, modern: true },
  { name: 'CookieYes', slug: 'cookie-law-info', ns: 'cky/v1', html: /cookieyes|cky-consent|cookie-law-info/i, modern: true },
  { name: 'Cookiebot', html: /consent\.cookiebot\.com|CookiebotCallback|Cookiebot/i, modern: true },
  { name: 'Borlabs Cookie', slug: 'borlabs-cookie', html: /borlabs/i, modern: true },
  { name: 'Real Cookie Banner', slug: 'real-cookie-banner', html: /real-cookie-banner|rcb-banner/i, modern: true },
  { name: 'Usercentrics', html: /usercentrics/i, modern: true },
  { name: 'OneTrust', html: /onetrust|optanon/i, modern: true },
  { name: 'Iubenda', html: /iubenda/i, modern: true },
  { name: 'Cookie Notice', slug: 'cookie-notice', html: /cookie-notice-js|cn-notice|cookie-notice-front/i, modern: false },
  { name: 'EU Cookie Law', slug: 'eu-cookie-law', html: /eu-cookie-law|eucookielaw|catapult-cookie/i, modern: false },
  { name: 'GDPR Cookie Compliance', slug: 'gdpr-cookie-compliance', html: /moove_gdpr|moove-gdpr/i, modern: true },
  { name: 'GDPR Cookie Consent (régi CookieYes)', html: /cli_settings_button|cookie-law-info-bar/i, modern: false },
];
export const ECOM = [
  { name: 'WooCommerce', slug: 'woocommerce', ns: 'wc/store', html: /woocommerce/i },
  { name: 'Easy Digital Downloads', slug: 'easy-digital-downloads', html: /edd-/i },
];
export const MULTILANG = [
  { name: 'WPML', slug: 'sitepress-multilingual-cms', html: /wpml/i },
  { name: 'Polylang', slug: 'polylang', ns: 'pll/v1', html: /polylang|pll_/i },
  { name: 'TranslatePress', slug: 'translatepress-multilingual', html: /translatepress|trp-language/i },
  { name: 'Weglot', html: /weglot/i },
  { name: 'GTranslate', slug: 'gtranslate', html: /gtranslate/i },
];
export const BOOKING = [
  { name: 'Amelia', slug: 'ameliabooking', html: /amelia/i },
  { name: 'The Events Calendar', slug: 'the-events-calendar', ns: 'tribe/events/v1', html: /tribe-events/i },
  { name: 'MotoPress Hotel Booking', slug: 'motopress-hotel-booking', html: /mphb/i },
  { name: 'Bookly', slug: 'bookly-responsive-appointment-booking-tool', html: /bookly/i },
  { name: 'LearnDash', slug: 'sfwd-lms', html: /learndash/i },
  { name: 'MemberPress', slug: 'memberpress', html: /memberpress|mepr-/i },
];
export const FORMS = [
  { name: 'Contact Form 7', slug: 'contact-form-7', ns: 'contact-form-7/v1', html: /wpcf7/i },
  { name: 'WPForms', slug: 'wpforms-lite', html: /wpforms/i },
  { name: 'Gravity Forms', slug: 'gravityforms', html: /gform_/i },
  { name: 'Fluent Forms', slug: 'fluentform', html: /fluentform/i },
  { name: 'Ninja Forms', slug: 'ninja-forms', html: /ninja-forms/i },
  { name: 'Formidable', slug: 'formidable', html: /frm_forms|formidable/i },
];
// kockázatos pluginok (fájlkezelők, ismert sebezhetőségi múlttal rendelkező, nem éles környezetbe valók)
export const RISKY = {
  'wp-file-manager': 'File Manager – fájlkezelő a böngészőből (kiemelt támadási felület)',
  'file-manager-advanced': 'File Manager Advanced – fájlkezelő a böngészőből',
  'filester': 'Filester – fájlkezelő a böngészőből',
  'wp-phpmyadmin-extension': 'phpMyAdmin a WordPressben',
  'duplicator': 'Duplicator – éles oldalon hátrahagyott csomagok kockázata',
  'all-in-one-wp-migration': 'All-in-One WP Migration – exportok az uploads mappában',
  'wp-reset': 'WP Reset – éles oldalon nem kívánatos',
  'code-snippets': 'Code Snippets – PHP futtatás az adminból (jogosultságkezelést igényel)',
  'insert-php': 'Insert PHP – PHP futtatás tartalomból',
  'revslider': 'Slider Revolution – régi verziói súlyosan sebezhetők',
};
// nyomkövetők a hálózati forgalomban
export const TRACKERS = {
  'Google Analytics 4': /google-analytics\.com\/g\/collect|analytics\.google\.com\/g\/collect|region1\.google-analytics\.com/,
  'Universal Analytics (megszűnt)': /google-analytics\.com\/(r\/)?collect|google-analytics\.com\/analytics\.js/,
  'Google Tag Manager / gtag': /googletagmanager\.com\/(gtm|gtag)\/js/,
  'Google Ads': /googleadservices\.com|googleads\.g\.doubleclick\.net|google\.com\/pagead/,
  'Facebook Pixel': /connect\.facebook\.net|facebook\.com\/tr/,
  'Microsoft Clarity': /clarity\.ms/,
  'Hotjar': /hotjar\.com|hotjar\.io/,
  'TikTok Pixel': /analytics\.tiktok\.com/,
  'LinkedIn Insight': /snap\.licdn\.com|px\.ads\.linkedin\.com/,
  'YouTube beágyazás': /youtube\.com\/embed|youtube-nocookie\.com\/embed|ytimg\.com/,
  'Vimeo beágyazás': /player\.vimeo\.com/,
  'Google Maps': /maps\.googleapis\.com|google\.com\/maps|maps\.gstatic\.com/,
  'reCAPTCHA': /google\.com\/recaptcha|gstatic\.com\/recaptcha|recaptcha\.net/,
  'Google Fonts': /fonts\.googleapis\.com|fonts\.gstatic\.com/,
};
export const TRACKER_COOKIES = /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc|_hj|_clck|_clsk|_tt_|_ttp|li_|IDE$|NID$|_uetsid|_uetvid)/;
// tracker-kategóriák: analitika/marketing = hozzájárulás-köteles; beágyazás = külső adatátadás
export const TRACKER_KIND = { 'Google Analytics 4': 'analytics', 'Universal Analytics (megszűnt)': 'analytics', 'Google Tag Manager / gtag': 'tag', 'Google Ads': 'marketing', 'Facebook Pixel': 'marketing', 'Microsoft Clarity': 'analytics', 'Hotjar': 'analytics', 'TikTok Pixel': 'marketing', 'LinkedIn Insight': 'marketing', 'YouTube beágyazás': 'embed', 'Vimeo beágyazás': 'embed', 'Google Maps': 'embed', 'reCAPTCHA': 'embed', 'Google Fonts': 'fonts' };
// spam-kulcsszavak (REST-keresés és sitemap-szűrés). A „bet” szándékosan nincs benne (pl. „beteg” téves találat).
export const SPAM_TERMS = ['casino', 'kaszinó', 'kaszino', 'betting', 'bookmaker', 'sportfogadás', 'slot', 'jackpot', 'poker', 'póker', 'roulette', 'rulett', 'gambling', '1xbet', 'mostbet', 'pin-up', 'vavada', 'viagra', 'cialis', 'payday loan', 'crypto casino', 'bonus code', 'free spins'];
export const SPAM_RX = /casino|kaszin[oó]|betting|bookmaker|sportfogad|\bslots?\b|jackpot|p[oó]ker|roulette|rulett|gambling|1xbet|mostbet|pin-?up|vavada|viagra|cialis|payday|free-?spins|bonus-?code/i;
