/**
 * How far a book of an extra source (extras/) has downloaded, with a Cancel: pages done of all
 * (Wikisource), a share of the file (Dicta's zips), or a spinner where that is not known
 * (Otzaria's single file). ExtraDownloadStatus is the line itself (also in Settings, while
 * "Check for updates" downloads); ExtraDownloadModal shows it over the reader while a book opened
 * from the library downloads.
 */
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import strings, { isolate } from './LocalizedStrings';
import * as extras from './extras';

/** The progress as words ("12 of 340 pages", "42%"), or null when it is not known */
export function progressText(p) {
  if (!p || !p.unit || !p.total) { return null; }
  if (p.unit === 'pages') {
    return strings.formatString(strings.extras.progress_pages, { done: p.done, total: p.total });
  }
  return strings.formatString(strings.extras.progress_percent, { percent: Math.round((100 * p.done) / p.total) });
}

/** The extras' download progress of one book, kept up to date */
export function useDownloadProgress(title) {
  const [progress, setProgress] = useState(() => extras.downloadProgress(title));
  useEffect(() => {
    setProgress(extras.downloadProgress(title));
    return extras.subscribe(() => setProgress(extras.downloadProgress(title)));
  }, [title]);
  return progress;
}

export const ExtraDownloadStatus = ({ title, theme, langStyle }) => {
  const progress = useDownloadProgress(title);
  if (!progress) { return null; }
  const text = progressText(progress);
  const share = text ? Math.min(1, progress.done / progress.total) : null;
  return (
    <View style={local.status} testID="extra-download-status">
      <View style={local.row}>
        {share === null ? <ActivityIndicator /> : null}
        {text ? <Text style={[langStyle, theme.secondaryText, local.text]}>{text}</Text> : null}
        <TouchableOpacity
          onPress={() => extras.cancelDownload(title)}
          accessibilityRole="button"
          style={local.cancel}
        >
          <Text style={[langStyle, theme.text, local.cancelText]}>{strings.common.cancel}</Text>
        </TouchableOpacity>
      </View>
      {share !== null ? (
        <View style={local.bar}>
          <View style={[local.fill, { width: `${Math.round(share * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
};

export const ExtraDownloadModal = ({ title, name, theme, langStyle }) => (
  <Modal transparent visible={!!title} animationType="fade" onRequestClose={() => extras.cancelDownload(title)}>
    <View style={local.backdrop}>
      <View style={[local.card, theme.mainTextPanel]}>
        <Text style={[langStyle, theme.text, local.title]}>
          {strings.formatString(strings.extras.downloading, { title: isolate(name || title) })}
        </Text>
        <ExtraDownloadStatus title={title} theme={theme} langStyle={langStyle} />
      </View>
    </View>
  </Modal>
);

const local = StyleSheet.create({
  status: { marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, fontSize: 14, marginHorizontal: 8 },
  cancel: { paddingVertical: 6, paddingHorizontal: 10 },
  cancelText: { fontSize: 14, textDecorationLine: 'underline' },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6, backgroundColor: '#ddd' },
  fill: { height: 4, backgroundColor: '#18345D' },
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.4)' },
  card: { borderRadius: 8, padding: 18, backgroundColor: '#fff' },
  title: { fontSize: 16, marginBottom: 6 },
});
