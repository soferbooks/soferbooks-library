import Sefaria from "./sefaria";

export const getSafeViewCategory = ({menu, navigationCategories, sheet, textTitle}) => {
    if (menu === 'navigation' && navigationCategories.length) {
        return navigationCategories[0];
    }
    if (!menu || menu === 'text toc' || menu === 'sheet meta') {
       return Sefaria.primaryCategoryForTitle(textTitle, !!sheet);
    }
    if (menu === "settings" || !!sheet) {
        return "Other";
    }
    return "N/A";
};

export const getSafeViewStyleAndStatusBarBackground = ({menuOpen:menu, navigationCategories, sheet, textTitle}, defaultSafeViewStyle, isWhiteTheme) => {
    // make the SafeAreaView background based on the category color
    const cat = getSafeViewCategory({menu, navigationCategories, sheet, textTitle});
    let statusBarBackgroundColor = "black";
    let safeViewStyle = {backgroundColor: statusBarBackgroundColor};
    if (cat) {
        if (cat === "N/A") {
            safeViewStyle = defaultSafeViewStyle;
            // (the page's own colour: white, or cream)
            statusBarBackgroundColor = isWhiteTheme ? ((defaultSafeViewStyle && defaultSafeViewStyle.backgroundColor) || "white") : "#333331";
        } else {
            statusBarBackgroundColor = Sefaria.palette.categoryColor(cat);
            safeViewStyle = {backgroundColor: statusBarBackgroundColor};
        }
    }
    const statusBarStyle = isWhiteTheme && cat==="N/A" ? 'dark-content' : 'light-content';
    return {safeViewStyle, statusBarBackgroundColor, statusBarStyle};
};
