import React from 'react';
import Sefaria from "../sefaria";
import {useAsyncVariable, useGlobalState} from "../Hooks";
import {isDiaspora} from "./calendarLocation";

export const useCalendarItems = () => {
    // calendarLocation: Israel or outside Israel, from Settings (a guess from the phone until chosen)
    const {preferredCustom, calendarLocation} = useGlobalState();
    const calendarLoaded = useAsyncVariable(!!Sefaria.calendar, Sefaria._loadCalendar);
    const calendarItems = Sefaria.getCalendars(preferredCustom, isDiaspora(calendarLocation));
    return {
        calendarLoaded,
        calendarItems,
    };
};
