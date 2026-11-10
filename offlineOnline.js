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
                return api.textApi(ref, context, versions, failSilently)
                    .then(data => {
                        api.processTextApiData(ref, context, versions, data);
                        return data;
                    })
                    .then(data => avoidHiddenTranslationOnline(ref, context, versions, failSilently, data))
            }
            // Unexpected: offline loading failed for a reason other than "not downloaded"
            // (e.g. a bug while parsing/assembling the offline file, or a corrupt file).
            console.error("Unexpected error while loading text from offline library (not a MISSING_OFFLINE_DATA miss)", error);
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

const avoidHiddenTranslationOnline = async (ref, context, versions, failSilently, data) => {
    /**
     * Content filter: the server sent its default English, and the reader's filter hides it.
     * Load the first English translation the filter allows instead; if there is none, show the
     * Hebrew only.
     */
    if (!context) { return versions?.en ? data : avoidHiddenPreviewOnline(data); }
    const textContent = data?.textContent;
    if (!textContent || !shomer.isActive() || versions?.en ||
        !shomer.isVersionHidden({versionTitle: textContent.versionTitle, versionSource: textContent.versionSource})) {
        return data;
    }
    try {
        const allowed = shomer.filterVersions(await api.versions(ref, true)) || [];
        const en = allowed.find(v => v.language === 'en');
        if (en) {
            const newVersions = {...(versions || {}), en: en.versionTitle};
            const other = await api.textApi(ref, context, newVersions, failSilently);
            api.processTextApiData(ref, context, newVersions, other);
            if (other?.textContent) { return other; }
        }
    } catch (e) {
        console.log('content filter: could not load another translation', e);
    }
    return {...data, textContent: shomer.stripHiddenEnglish(textContent)};
};

// The same for a single-ref preview without context (commentary/links panel, inline commentary):
// {result: {en, he, versionTitle, versionSource}}. These load one by one for a whole panel, so
// rather than fetch another translation for each, a hidden English is just left out (Hebrew only).
const avoidHiddenPreviewOnline = (data) => {
    const result = data?.result;
    const safe = shomer.stripHiddenPreviewEnglish(result);
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
    const cached = api._related[ref];
    if (!!cached) { return shomer.filterRelated(cached); }
    const loader = online && !isExtraRef(ref) ? api.related : loadLinksOffline;
    const response = await loader(ref);
    api._related[ref] = response;
    return shomer.filterRelated(response);  // content filter (links to hidden books drop out with the TOC)
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
