# The pinned tabs widget's place in the Xcode project (ios/PinnedTabsWidget, widgets/pinnedTabsWidget.js).
# Added at build time with CocoaPods' xcodeproj library (no Mac here to add it in Xcode); running it again
# changes nothing. Called by fastlane/Fastfile before every iOS build.
require 'xcodeproj'

module PinnedTabsWidgetProject
  TARGET = 'PinnedTabsWidget'.freeze
  BUNDLE_ID = 'com.soferbooks.library.PinnedTabsWidget'.freeze
  APP_TARGET = 'ReaderApp'.freeze

  # Adds the widget extension and the app's Swift module files to `project_path` (once), and keeps the
  # widget's version the app's. Returns the project.
  def self.add!(project_path)
    project = Xcodeproj::Project.open(project_path)
    app = project.targets.find { |t| t.name == APP_TARGET } or raise "no #{APP_TARGET} target"
    ios_dir = File.dirname(project_path)

    # the app's own native modules (PinnedTabsWidgetModule.swift, NativeModules.m)
    app_group = project.main_group.find_subpath('ReaderApp', false) || project.main_group
    %w[PinnedTabsWidgetModule.swift NativeModules.m].each do |name|
      next if app.source_build_phase.files_references.any? { |r| r && r.path && File.basename(r.path) == name }
      ref = app_group.new_reference(File.join(ios_dir, 'ReaderApp', name))
      app.add_file_references([ref])
    end

    widget = project.targets.find { |t| t.name == TARGET }
    unless widget
      widget = project.new_target(:app_extension, TARGET, :ios, '17.0', nil, :swift)
      group = project.main_group.new_group(TARGET, File.join(ios_dir, TARGET))
      swift = group.new_reference(File.join(ios_dir, TARGET, 'PinnedTabsWidget.swift'))
      group.new_reference(File.join(ios_dir, TARGET, 'Info.plist'))
      group.new_reference(File.join(ios_dir, TARGET, 'PinnedTabsWidget.entitlements'))
      widget.add_file_references([swift])
      %w[WidgetKit SwiftUI].each { |f| widget.add_system_framework(f) }

      # embedded in the app (Embed Foundation Extensions)
      app.add_dependency(widget)
      embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
              app.new_copy_files_build_phase('Embed Foundation Extensions')
      embed.dst_subfolder_spec = Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:plug_ins]
      build_file = embed.add_file_reference(widget.product_reference, true)
      build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
    end

    widget.build_configurations.each do |config|
      app_config = app.build_configurations.find { |c| c.name == config.name } || app.build_configurations.first
      s = config.build_settings
      s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
      s['PRODUCT_NAME'] = '$(TARGET_NAME)'
      s['INFOPLIST_FILE'] = "#{TARGET}/Info.plist"
      s['CODE_SIGN_ENTITLEMENTS'] = "#{TARGET}/PinnedTabsWidget.entitlements"
      s['SWIFT_VERSION'] = '5.0'
      s['TARGETED_DEVICE_FAMILY'] = '1,2'
      s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'  # (the one-tab widget's choice of tab: App Intents, iOS 17)
      s['SKIP_INSTALL'] = 'YES'
      s['GENERATE_INFOPLIST_FILE'] = 'NO'
      s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
      s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
      # (App Store Connect wants an extension's version to be its app's)
      %w[MARKETING_VERSION CURRENT_PROJECT_VERSION DEVELOPMENT_TEAM].each do |k|
        s[k] = app_config.build_settings[k] if app_config.build_settings[k]
      end
    end
    project.save
    project
  end
end

PinnedTabsWidgetProject.add!(ARGV[0]) if $PROGRAM_NAME == __FILE__ && ARGV[0]
