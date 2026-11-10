import React, {useCallback}  from 'react';
import {View, FlatList, Image, Platform} from "react-native";
import Sefaria from "./sefaria";
import {displayRef} from "./extras/schema7";
import {
    CategoryButton,
    CategoryColorLine,
    ContentTextWithFallback,
    FlexFrame,
    LanguageToggleButton,
    PageHeader,
    InterfaceText,
    SefariaPressable,
} from "./Misc";
import styles from "./Styles";
import {LearningSchedulesBox} from "./learningSchedules/LearningSchedulesBox";
import {useGlobalState} from "./Hooks";
import {TextCategoryPage} from "./TextCategoryPage";
import strings from "./LocalizedStrings";
import OpenTabsStrip from "./tabs/OpenTabsStrip";

/**
 * SoferBooks Library home page (replaces Sefaria's texts page / feed). Top to bottom:
 *   1. Open tabs strip  - placeholder slot, see OpenTabsSlot below
 *   2. Continue reading - the most recent place in each book, from on-device history
 *   3. Today's learning - the existing learning-schedule (calendar) items
 *   4. Library          - the top-level category shelves
 * Choosing a category replaces the page with that category (TextCategoryPage), as before.
 */

const CONTINUE_READING_COUNT = 4;
// Sefaria's calendar.json items, and the app's own (learningSchedules/extraSchedules.js), in calendar order
const TODAYS_LEARNING_CALENDARS = [
    'Parashat Hashavua', 'Shnayim Mikra', 'Haftarah', 'Daf Yomi', 'Daily Mishnah',
    'Daily Rambam', 'Daily Rambam (3 Chapters)', 'Mishnah Berurah Yomi', 'Chok LeYisrael',
    'Tehillim (Monthly)', 'Tehillim (Weekly)',
];

const useCategoryButtonProps = (tocItem, setCategories) => {
    const {category, heCategory, enDesc, heDesc, enShortDesc, heShortDesc} = tocItem;
    const title = {
        en: category,
        he: heCategory,
    };
    const description = {
        en: enShortDesc || enDesc,
        he: heShortDesc || heDesc,
    };
    const onPress = useCallback(() => {
        setCategories([category]);
    }, [category]);
    return {
        title, description, onPress,
    }
}

/**
 * "Open tabs" strip: a horizontal strip of the reader's open tabs, just below the logo, with the
 * same heading as the other home sections (tabs/OpenTabsStrip.js). Nothing when no tabs are open.
 */
const OpenTabsHeader = () => <HomeSectionHeader titleKey={"tabs.open_tabs"} />;
const OpenTabsSlot = () => <OpenTabsStrip Header={OpenTabsHeader} />;

// Home-page headings are set in Cinzel in English; Hebrew keeps the interface font (Cinzel is
// Latin-only). Cinzel is bundled as an Android asset font only, so iOS keeps the interface font.
const useHeadingFont = () => {
    const { interfaceLanguage } = useGlobalState();
    return interfaceLanguage === 'hebrew' || Platform.OS !== 'android' ? null : styles.homeHeadingFont;
};

const HomeSectionHeader = ({ titleKey, actionKey, onAction }) => {
    const { theme } = useGlobalState();
    const headingFont = useHeadingFont();
    return (
        <FlexFrame dir={"row"} justifyContent={"space-between"} alignItems={"center"}>
            <InterfaceText stringKey={titleKey} extraStyles={[styles.homeSectionHeader, theme.brandColorText, headingFont]}/>
            {onAction ? (
                <SefariaPressable onPress={onAction}>
                    <InterfaceText stringKey={actionKey} extraStyles={[styles.fontSize16, theme.secondaryText]}/>
                </SefariaPressable>
            ) : null}
        </FlexFrame>
    );
};

const ContinueReading = ({ openRef, openHistory }) => {
    const { theme, readingHistory } = useGlobalState();
    const items = readingHistory ? (Sefaria.history.lastPlace || []).slice(0, CONTINUE_READING_COUNT) : [];
    if (!items.length) { return null; }
    return (
        <View style={styles.homeSection}>
            <HomeSectionHeader titleKey={"home.continue_reading"} actionKey={"common.see_all"} onAction={openHistory} />
            {items.map(item => (
                <SefariaPressable key={item.ref} onPress={() => openRef(item.ref, item.versions)}>
                    <View style={[styles.homeContinueRow, theme.lighterGreyBorder]}>
                        <CategoryColorLine category={Sefaria.primaryCategoryForTitle(item.book || Sefaria.textTitleForRef(item.ref))} thickness={4}/>
                        <ContentTextWithFallback
                            en={displayRef(item.ref, item.he_ref || item.heRef)}
                            he={(item.he_ref || item.heRef) ? Sefaria.normHebrewRef(item.he_ref || item.heRef) : item.ref}
                            extraStyles={[styles.homeContinueText, theme.text]}
                        />
                    </View>
                </SefariaPressable>
            ))}
        </View>
    );
};

const TodaysLearning = ({ openRef, openLearningSchedules }) => {
    const { theme } = useGlobalState();
    const headingFont = useHeadingFont();
    return (
        <View style={styles.homeSection}>
            <LearningSchedulesBox openRef={openRef} desiredCalendarTitles={TODAYS_LEARNING_CALENDARS}>
                <FlexFrame dir={"row"} justifyContent={"space-between"}>
                    <InterfaceText stringKey={"home.todays_learning"} extraStyles={[styles.fontSize16, styles.fontBold, theme.brandColorText, headingFont]}/>
                    <SefariaPressable onPress={openLearningSchedules}>
                        <InterfaceText stringKey={"common.see_all"} extraStyles={[styles.fontSize16, theme.secondaryText]}/>
                    </SefariaPressable>
                </FlexFrame>
            </LearningSchedulesBox>
        </View>
    );
};

const TopLevelCategory = ({item: tocItem, setCategories}) => {
    const categoryButtonProps = useCategoryButtonProps(tocItem, setCategories);
    return (
        <View>
            <CategoryColorLine category={tocItem.category} thickness={4}/>
            <CategoryButton {...categoryButtonProps} />
        </View>
    );
};

const HomeLogo = () => {
    const { themeStr } = useGlobalState();
    const source = themeStr === 'white' ? require('./img/soferbooks-logo.png') : require('./img/soferbooks-logo-light.png');
    return <Image source={source} resizeMode={'contain'} style={styles.homeLogo} accessibilityLabel={strings.a11y.soferbooks_logo} />;
};

// "Browse the library": Misc's Header, with the home-page heading font
const LibraryHeader = () => {
    const { theme } = useGlobalState();
    const headingFont = useHeadingFont();
    return <InterfaceText stringKey={"nav.browse_the_library"} extraStyles={[styles.navReHeaderText, theme.tertiaryText, headingFont]} />;
};

const HomePageHeader = ({ openRef, openHistory, openLearningSchedules }) => (
    <View>
        <FlexFrame dir={"row"} justifyContent={"space-between"} alignItems={"center"}>
            <HomeLogo />
            <LanguageToggleButton />
        </FlexFrame>
        <OpenTabsSlot />
        <ContinueReading openRef={openRef} openHistory={openHistory} />
        <TodaysLearning openRef={openRef} openLearningSchedules={openLearningSchedules} />
        <PageHeader><LibraryHeader /></PageHeader>
    </View>
);

const HomePageFooter = ({ openAbout }) => {
    const { theme } = useGlobalState();
    return (
        <View style={styles.homeFooter}>
            <SefariaPressable onPress={openAbout}>
                <InterfaceText stringKey={"about.about_soferbooks"} extraStyles={[styles.fontSize16, theme.secondaryText]}/>
            </SefariaPressable>
        </View>
    );
};

export const TextsPage = ({categories, setCategories, openRef, openLearningSchedules, onBack, openAbout, openHistory}) => {
    const { theme } = useGlobalState();

    if (categories.length) {
        return (
            <TextCategoryPage
                categories={categories}
                setCategories={setCategories}
                openRef={openRef}
                onBack={onBack}
            />
        )
    }

    const data = Sefaria.getRootTocItems();
    return (
        // outer view with flexDirection row properly bounds the FlatList so it doesn't overflow horizontally on some displays.
        <View style={{flex: 1, flexDirection: "row"}}>
            <FlatList
                data={data}
                contentContainerStyle={[{paddingHorizontal: 15, alignSelf: "stretch"}, theme.mainTextPanel]}
                ListHeaderComponent={
                    <HomePageHeader
                        openRef={openRef}
                        openHistory={openHistory}
                        openLearningSchedules={openLearningSchedules}
                    />
                }
                ListFooterComponent={<HomePageFooter openAbout={openAbout} />}
                keyExtractor={item => item.category}
                renderItem={({ item }) => (
                    <TopLevelCategory
                        item={item}
                        setCategories={setCategories}
                    />
                )}
            />
        </View>
    );
};
