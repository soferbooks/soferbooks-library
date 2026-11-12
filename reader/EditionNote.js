'use strict';

/**
 * The note at the start of a section shown from another edition than the one being read
 * (reader/editionNotes.js): "This chapter is not in Torat Emet 357; shown from Version of the
 * Gemara - vocalized."
 */

import React from 'react';
import PropTypes from 'prop-types';
import { StyleSheet, Text, View } from 'react-native';
import styles from '../Styles';
import { editionNoteText } from './editionNotes';

const EditionNote = ({ notes, interfaceLanguage, chapters, theme }) => {
  if (!notes || !notes.length) { return null; }
  const hebrew = interfaceLanguage === 'hebrew';
  return (
    <View style={local.box} testID="edition-note">
      {notes.map(note => (
        <Text
          key={note.lang}
          style={[local.text, hebrew ? styles.heInt : styles.enInt, local.center, theme && theme.tertiaryText]}
        >
          {editionNoteText(note, { hebrew, chapters })}
        </Text>
      ))}
    </View>
  );
};
EditionNote.propTypes = {
  notes:             PropTypes.array,   // [{lang, missing, shown}] (editionNotesFor)
  interfaceLanguage: PropTypes.string,
  chapters:          PropTypes.bool,    // the book's sections are chapters
  theme:             PropTypes.object,
};

const local = StyleSheet.create({
  box: { marginHorizontal: 30, marginTop: -6, marginBottom: 14 },
  text: { fontSize: 14, lineHeight: 20 },
  center: { textAlign: 'center' },
});

export default EditionNote;
