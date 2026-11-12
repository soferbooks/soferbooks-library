/**
 * File for functions that can either load data from offline library or API, depending on which one exists
 * Prefers offline library data
 */

import {ERRORS} from "./errors";
import {
    loadTextIndexOffline,
    loadTextOffline,
    loadLinksOffline,
    getOfflineVersionObjectsAvailable,
    getAllTranslationsOffline,
    textFromRefData,
} from "./offline";
import api from "./api";
import * as shomer from "./shomer";
import * as extras from "./extras";
import {
    isEnglishTranslation, isForeignTitle, stripForeignEnglish, stripForeignPreviewEnglish,
    preferredEnglishVersion, isTanakhText,
} from "./translationLanguage";

// A ref in a book of an extra source (Otzaria ...): Sefaria's API does not know it, so it is
// never asked (its text, links, translations and index are on the phone or nowhere)
const isExtraRef = ref => {
    try { return extras.isExtraTitle(Sefaria.textTitleForRef(ref)); } catch (e) { return false; }
};


export const loadText = function(ref, context, versions, fallbackOnDefaultVersions=true, failSilently=false) {
    /**
     if `context`, only return section no matter what. default is true
     versions is object with keys { en, he } specifying version titles of requested ref
     Returns a promise that resolves to an object with either:
        {textContent, links: array} if context is truthy
        {result: LinkContent} if context is falsy
     */
    if (typeof context === "undefined") { context = true; }
    return loadTextOffline(ref, versions, fallbackOnDefaultVersions)
        .then(({textContent, links}) => {
            if (textContent?.missingLangs?.length) {
                throw ERRORS.MISSING_OFFLINE_DATA;
            }
            textContent = shomer.stripHiddenEnglish(textContent);  // content filter (normally the offline default already skips it)
            if (!context) {
                const result = textFromRefData(textContent);
                return {result};
            }

            return {textContent, links};
        })
        .catch(error => {
            if (error === ERRORS.MISSING_OFFLINE_DATA && isExtraRef(ref)) {
                // a book of an extra source (Otzaria ...): no online reader, it must be downloaded
                return Promise.reject(ERRORS.EXTRA_NOT_DOWNLOADED);
            }
            if (error === ERRORS.MISSING_OFFLINE_DATA) {
                // Expected case: the text isn't downloaded offline, so fall back to the API.
                // (the book's preferred English, once known, asked for at once: one request)
                const asked = withKnownPreferredEnglish(ref, context, versions);
                return api.textApi(ref, context, asked, failSilently)
                    .then(data => {
                        api.processTextApiData(ref, context, asked, data);
                        return data;
                    })
                    .then(data => preferEnglishOnline(ref, context, asked, failSilently, data, versions))
                    .then(data => avoidHiddenTranslationOnline(ref, context, asked, failSilently, data))
            }
            // Unexpected: offline loading failed for a reason other than "not downloaded"
            // (e.g. a bug while parsing/assembling the offline file, or a corrupt file).
            console.error("Unexpected error while loading text from offline library (not a MISSING_OFFLINE_DATA miss)", error);
            if (!isExtraRef(ref)) {
                // a Sefaria book on the phone that cannot be read (a zip left broken - QA round 14:
                // Rashi on Genesis 1 became "Text Unavailable"): read it from Sefaria instead
                return api.textApi(ref, context, versions, failSilently)
                    .then(data => {
                        api.processTextApiData(ref, context, versions, data);
                        return data;
                    })
                    .then(data => avoidHiddenTranslationOnline(ref, context, versions, failSilently, data));
            }
            return Promise.reject(error);
        })
        .catch((error) => {
            return Promise.reject(error);
        })
};

export const loadVersions = async (ref) => {
    let versions = getOfflineVersionObjectsAvailable(ref);
    if (!versions && isExtraRef(ref)) { return []; }
    if (!versions) {
        versions = await api.versions(ref, true);
    }
    return shomer.filterVersions(versions);  // content filter
};

// ---- the owner's order of English translations (translationLanguage.js), online
// {book title: the version title it prefers, or null for Sefaria's own}, once its versions are known
const _preferredEnglishByTitle = {};
// (the content filter changed: which translations it allows may have too)
if (typeof shomer.subscribe === "function") shomer.subscribe(() => { Object.keys(_preferredEnglishByTitle).forEach(k => { delete _preferredEnglishByTitle[k]; }); });
export const _forgetPreferredEnglish = () => { Object.keys(_preferredEnglishByTitle).forEach(k => { delete _preferredEnglishByTitle[k]; }); };

const tanakhCategories = ref => {
    try {
        const categories = Sefaria.categoriesForTitle(Sefaria.textTitleForRef(ref));
        return isTanakhText(categories) ? categories : null;
    } catch (e) { return null; }
};

/** versions with the book's preferred English when it is already known and none was asked for */
export const withKnownPreferredEnglish = (ref, context, versions) => {
    if (!context || versions?.en || !tanakhCategories(ref)) { return versions; }
    const title = Sefaria.textTitleForRef(ref);
    const known = _preferredEnglishByTitle[title];
    return known ? {...(versions || {}), en: known} : versions;
};

/**
 * The server sent its default English: for a book of Tanakh, the owner's preferred translation
 * instead when it has one the content filter allows (Metsudah, Koren, JPS 1985 ...). A translation
 * the reader asked for by name (requested.en) is kept.
 */
export const preferEnglishOnline = async (ref, context, versions, failSilently, data, requested = versions) => {
    const textContent = data?.textContent;
    const categories = tanakhCategories(ref);
    if (!context || requested?.en || !textContent || !categories) { return data; }
    const title = Sefaria.textTitleForRef(ref);
    try {
        if (!(title in _preferredEnglishByTitle)) {
            const best = preferredEnglishVersion(await api.versions(ref, true),
                {categories, isHidden: v => shomer.isActive() && shomer.isVersionHidden(v)});
            _preferredEnglishByTitle[title] = best ? best.versionTitle : null;
        }
        const want = _preferredEnglishByTitle[title];
        if (!want || want === textContent.versionTitle) { return data; }
        const newVersions = {...(versions || {}), en: want};
        const other = await api.textApi(ref, context, newVersions, failSilently);
        api.processTextApiData(ref, context, newVersions, other);
        return other?.textContent ? other : data;
    } catch (e) {
        console.log('could not load the preferred English translation', e);
        return data;
    }
};

const avoidHiddenTranslationOnline = async (ref, context, versions, failSilently, data) => {
    /**
     * The server sent its default English and the reader cannot show it: the content filter
     * hides it, or it is not English at all (Sefaria files German, French ... under 'en' too,
     * and sends one of those when there is no English). Load the first translation really in
     * English that the filter allows instead; if there is none, show the Hebrew only.
     * A translation asked for by name (versions.en, picked from the menu) is always kept.
     */
    if (!context) { return versions?.en ? data : avoidHiddenPreviewOnline(data); }
    const textContent = data?.textContent;
    if (!textContent || versions?.en || !textContent.versionTitle) { return data; }
    const hidden = shomer.isActive() &&
        shomer.isVersionHidden({versionTitle: textContent.versionTitle, versionSource: textContent.versionSource});
    if (!hidden && !isForeignTitle(textContent.versionTitle)) { return data; }
    try {
        const allowed = shomer.filterVersions(await api.versions(ref, true)) || [];
        const en = allowed.find(v => isEnglishTranslation(v) && v.versionTitle !== textContent.versionTitle);
        if (en) {
            const newVersions = {...(versions || {}), en: en.versionTitle};
            const other = await api.textApi(ref, context, newVersions, failSilently);
            api.processTextApiData(ref, context, newVersions, other);
            if (other?.textContent) {
                // (a version without this section may come back as the server default again)
                return withoutUnwantedEnglish(other);
            }
        }
    } catch (e) {
        console.log('could not load an English translation', e);
    }
    return withoutUnwantedEnglish(data);
};

// The section with a hidden or non-English English line taken out (Hebrew only), and the
// section's current versions told so (the menus then show no English version as in use)
const withoutUnwantedEnglish = (data) => {
    const textContent = data.textContent;
    const safe = stripForeignEnglish(shomer.stripHiddenEnglish(textContent));
    if (safe === textContent) { return data; }
    try {
        Sefaria.cacheCurrVersionsBySection({en: null, he: textContent.heVersionTitle}, textContent.sectionRef);
    } catch (e) { /* no cache to fix */ }
    return {...data, textContent: safe};
};

// The same for a single-ref preview without context (commentary/links panel, inline commentary):
// {result: {en, he, versionTitle, versionSource}}. These load one by one for a whole panel, so
// rather than fetch another translation for each, a hidden or non-English one is just left out
// (Hebrew only).
const avoidHiddenPreviewOnline = (data) => {
    const result = data?.result;
    const safe = stripForeignPreviewEnglish(shomer.stripHiddenPreviewEnglish(result));
    return safe === result ? data : {...data, result: safe};
};

export const loadTranslations = async (ref, online=true) => {
    const offlineTranslations = await getAllTranslationsOffline(ref);
    let translations = offlineTranslations?.translations || [];
    // Translations are secondary/optional data. Only hit the API when online, so a device
    // that's known to be offline never pops a blocking no-internet alert.
    if (online && !isExtraRef(ref) && (!offlineTranslations || offlineTranslations.missingVersions.length)) {
        translations = await api.translations(ref);
    }
    return shomer.filterTranslations(translations);  // content filter
}

export const loadRelated = async function(ref, online) {
    // Sefaria's links (online or offline), with the downloaded extra books' links of the section
    // added (extras/links.js: an extra book's own connections, and the extra commentaries on a
    // Sefaria passage). Added each time, not cached, so a book just downloaded or deleted shows.
    let response = api._related[ref];
    if (!response) {
        const loader = online && !isExtraRef(ref) ? api.related : loadLinksOffline;
        try {
            response = await loader(ref);
        } catch (error) {
            // (Sefaria's links could not be had - offline, not downloaded: the extra books' still can)
            const extra = await extras.extraLinksFor(ref);
            if (!extra.length) { throw error; }
            return shomer.filterRelated({links: extra});
        }
        api._related[ref] = response;
    }
    // content filter (links to hidden books drop out with the TOC)
    return shomer.filterRelated(await extras.withExtraLinks(ref, response));
};

const _textToc = {};

export const textToc = function(title) {
    return new Promise((resolve, reject) => {
        const resolver = function(data) {
            _textToc[title] = data;
            Sefaria.cacheVersionObjectByTitle(data.versions, title);
            resolve(data);
        };
        if (title in _textToc) {
            resolve(_textToc[title]);
        } else {
            // loadTextIndexOffline answers null (not an error) when the index cannot be read;
            // that used to throw inside resolver, fall back to the API, and - offline - leave
            // this promise pending forever, so the reader never loaded the section's
            // translations and related texts (QA: "Translations (0)", no related texts).
            // Try the offline index twice (a book can be mid-unzip), then the API; settle either way.
            const offlineIndex = () => loadTextIndexOffline(title).then(index => {
                if (!index) { throw new Error(`no offline index for ${title}`); }
                return index;
            });
            offlineIndex()
                .catch(() => new Promise(r => setTimeout(r, 300)).then(offlineIndex))
                .then(resolver)
                .catch(error => (extras.isExtraTitle(title) ? Promise.reject(error)
                    : api._request(title, 'index', true, {}, true).then(resolver)))
                .catch(reject);
        }
    });
};
