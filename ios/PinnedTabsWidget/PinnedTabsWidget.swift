//  The home-screen widget of the pinned tabs (owner, 2026-11-24: "can we add widgets that are shortcuts to
//  pinned tabs (ios too)"). The app hands it the rows (widgets/pinnedTabsWidget.js -> PinnedTabsWidgetModule)
//  through a keychain item both share; each row opens soferbooks://tab/<id>, the tab at its last place.

import WidgetKit
import SwiftUI
import Security
import AppIntents

struct PinnedTabItem: Codable, Hashable {
  let tabId: String
  let label: String
  let sublabel: String?
  let url: String
}

struct PinnedTabsSnapshot: Codable {
  let hebrew: Bool
  let dark: Bool
  let items: [PinnedTabItem]    // the pinned tabs
  var tabs: [PinnedTabItem]?    // every open tab (the one-tab widget's choices)
  static let empty = PinnedTabsSnapshot(hebrew: false, dark: false, items: [], tabs: [])
  var openTabs: [PinnedTabItem] { tabs ?? items }
}

enum PinnedTabsStore {
  static let service = "com.soferbooks.library.pinnedTabsWidget"
  static let account = "snapshot"
  static let accessGroup = "2626EW4BML.com.soferbooks.library.shared"

  static func read() -> PinnedTabsSnapshot {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
          let snapshot = try? JSONDecoder().decode(PinnedTabsSnapshot.self, from: data) else { return .empty }
    return snapshot
  }
}

struct PinnedTabsEntry: TimelineEntry {
  let date: Date
  let snapshot: PinnedTabsSnapshot
}

struct PinnedTabsProvider: TimelineProvider {
  func placeholder(in context: Context) -> PinnedTabsEntry {
    PinnedTabsEntry(date: Date(), snapshot: PinnedTabsSnapshot(hebrew: false, dark: false, items: [
      PinnedTabItem(tabId: "1", label: "Shabbat", sublabel: "Shabbat 8a", url: "soferbooks://tab/1"),
      PinnedTabItem(tabId: "2", label: "Psalms", sublabel: "Psalms 23", url: "soferbooks://tab/2"),
    ], tabs: nil))
  }

  func getSnapshot(in context: Context, completion: @escaping (PinnedTabsEntry) -> Void) {
    let stored = PinnedTabsStore.read()
    completion(context.isPreview && stored.items.isEmpty ? placeholder(in: context) : PinnedTabsEntry(date: Date(), snapshot: stored))
  }

  // (redrawn only when the app's tabs change: WidgetCenter.reloadAllTimelines)
  func getTimeline(in context: Context, completion: @escaping (Timeline<PinnedTabsEntry>) -> Void) {
    completion(Timeline(entries: [PinnedTabsEntry(date: Date(), snapshot: PinnedTabsStore.read())], policy: .never))
  }
}

private struct Palette {
  let bg: Color, text: Color, sub: Color, line: Color
  static let cream = Palette(bg: Color(red: 0xFB / 255, green: 0xF4 / 255, blue: 0xE4 / 255),
                             text: Color(red: 0x2B / 255, green: 0x21 / 255, blue: 0x16 / 255),
                             sub: Color(red: 0x8F / 255, green: 0x82 / 255, blue: 0x70 / 255),
                             line: Color(red: 0xE3 / 255, green: 0xD5 / 255, blue: 0xB8 / 255))
  static let dark = Palette(bg: Color(red: 0x33 / 255, green: 0x33 / 255, blue: 0x31 / 255),
                            text: .white, sub: Color(white: 0.73), line: Color(white: 0.33))
}

extension View {
  @ViewBuilder func pinnedTabsBackground(_ color: Color) -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(color, for: .widget)
    } else {
      padding().background(color)
    }
  }
}

struct PinnedTabsView: View {
  @Environment(\.widgetFamily) var family
  let entry: PinnedTabsEntry

  var body: some View {
    let s = entry.snapshot
    let p = s.dark ? Palette.dark : Palette.cream
    let max = family == .systemLarge ? 8 : (family == .systemMedium ? 3 : 3)
    VStack(alignment: .leading, spacing: 0) {
      Text(s.hebrew ? "כרטיסיות מוצמדות" : "Pinned tabs")
        .font(.caption).bold().foregroundColor(p.sub).padding(.bottom, 4)
      if s.items.isEmpty {
        Text(s.hebrew ? "אפשר להצמיד כרטיסייה בספריית SoferBooks (לחיצה ארוכה עליה בשורת הכרטיסיות) כדי לראות אותה כאן."
                      : "Pin a tab in SoferBooks Library (long-press it in the tab bar) to see it here.")
          .font(.footnote).foregroundColor(p.text)
      } else {
        ForEach(Array(s.items.prefix(max).enumerated()), id: \.element) { index, item in
          row(item, p).overlay(alignment: .bottom) {
            if index < min(max, s.items.count) - 1 { Rectangle().fill(p.line).frame(height: 1) }
          }
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .environment(\.layoutDirection, s.hebrew ? .rightToLeft : .leftToRight)
    .pinnedTabsBackground(p.bg)
    // (a small widget has no separate rows to tap: it opens its first tab)
    .widgetURL(family == .systemSmall ? s.items.first.flatMap { URL(string: $0.url) } : nil)
  }

  @ViewBuilder private func row(_ item: PinnedTabItem, _ p: Palette) -> some View {
    let content = VStack(alignment: .leading, spacing: 1) {
      Text(item.label).font(.headline).foregroundColor(p.text).lineLimit(1)
      if let sub = item.sublabel, !sub.isEmpty, family != .systemSmall {
        Text(sub).font(.caption).foregroundColor(p.sub).lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 4)
    if family != .systemSmall, let url = URL(string: item.url) {
      Link(destination: url) { content }
    } else {
      content
    }
  }
}

struct PinnedTabsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PinnedTabs", provider: PinnedTabsProvider()) { entry in
      PinnedTabsView(entry: entry)
    }
    .configurationDisplayName("Pinned tabs")
    .description("Your pinned tabs: tap one to open it where you left off.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

// MARK: - One tab (owner, 2026-11-24: "also add ability to have individual tabs as a button/widget"):
// a widget of one tab, chosen with Edit Widget from the open tabs

struct TabEntity: AppEntity {
  let id: String
  let label: String
  let sublabel: String
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Tab"
  static var defaultQuery = TabQuery()
  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: LocalizedStringResource(stringLiteral: label),
                          subtitle: sublabel.isEmpty ? nil : LocalizedStringResource(stringLiteral: sublabel))
  }
  init(_ item: PinnedTabItem) { id = item.tabId; label = item.label; sublabel = item.sublabel ?? "" }
}

struct TabQuery: EntityQuery {
  private func all() -> [TabEntity] {
    let s = PinnedTabsStore.read()
    let pinned = Set(s.items.map(\.tabId))
    // (the pinned first, as in the tab bar)
    return s.openTabs.sorted { pinned.contains($0.tabId) && !pinned.contains($1.tabId) }.map(TabEntity.init)
  }
  func entities(for identifiers: [TabEntity.ID]) async throws -> [TabEntity] {
    all().filter { identifiers.contains($0.id) }
  }
  func suggestedEntities() async throws -> [TabEntity] { all() }
  func defaultResult() async -> TabEntity? { all().first }
}

struct ChooseTabIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose a tab"
  static var description = IntentDescription("The tab this widget opens.")
  @Parameter(title: "Tab") var tab: TabEntity?
}

struct OneTabEntry: TimelineEntry {
  let date: Date
  let snapshot: PinnedTabsSnapshot
  let item: PinnedTabItem?
}

struct OneTabProvider: AppIntentTimelineProvider {
  private func entry(_ intent: ChooseTabIntent) -> OneTabEntry {
    let s = PinnedTabsStore.read()
    // (the tab as it is now - the place read last - or the first pinned one until one is chosen)
    let item = intent.tab.flatMap { chosen in s.openTabs.first { $0.tabId == chosen.id } } ?? s.items.first ?? s.openTabs.first
    return OneTabEntry(date: Date(), snapshot: s, item: item)
  }
  func placeholder(in context: Context) -> OneTabEntry {
    OneTabEntry(date: Date(), snapshot: .empty,
                item: PinnedTabItem(tabId: "1", label: "Shabbat", sublabel: "Shabbat 8a", url: "soferbooks://tab/1"))
  }
  func snapshot(for configuration: ChooseTabIntent, in context: Context) async -> OneTabEntry {
    let e = entry(configuration)
    return context.isPreview && e.item == nil ? placeholder(in: context) : e
  }
  func timeline(for configuration: ChooseTabIntent, in context: Context) async -> Timeline<OneTabEntry> {
    Timeline(entries: [entry(configuration)], policy: .never)
  }
}

struct OneTabView: View {
  let entry: OneTabEntry
  var body: some View {
    let p = entry.snapshot.dark ? Palette.dark : Palette.cream
    VStack(spacing: 2) {
      Text(entry.item?.label ?? "SoferBooks").font(.headline).foregroundColor(p.text)
        .multilineTextAlignment(.center).lineLimit(3).minimumScaleFactor(0.7)
      if let sub = entry.item?.sublabel, !sub.isEmpty, sub != entry.item?.label {
        Text(sub).font(.caption).foregroundColor(p.sub).lineLimit(2).multilineTextAlignment(.center)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .environment(\.layoutDirection, entry.snapshot.hebrew ? .rightToLeft : .leftToRight)
    .pinnedTabsBackground(p.bg)
    .widgetURL(entry.item.flatMap { URL(string: $0.url) })
  }
}

struct OneTabWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "OneTab", intent: ChooseTabIntent.self, provider: OneTabProvider()) { entry in
      OneTabView(entry: entry)
    }
    .configurationDisplayName("Tab")
    .description("One tab of your choice: tap it to open it where you left off. Choose the tab with Edit Widget.")
    .supportedFamilies([.systemSmall, .accessoryRectangular])
  }
}

@main
struct SoferBooksWidgets: WidgetBundle {
  var body: some Widget {
    PinnedTabsWidget()
    OneTabWidget()
  }
}
