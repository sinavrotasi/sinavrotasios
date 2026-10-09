require 'xcodeproj'
require 'fileutils'
require 'rexml/document'
root = File.expand_path('..', __dir__)
app = File.join(root, 'ios/App/App')
project_path = File.join(root, 'ios/App/App.xcodeproj')
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |t| t.name == 'App' }
abort 'App target bulunamadı' unless target
group = project.main_group.find_subpath('App', false)
abort 'App kaynak grubu bulunamadı' unless group
if ARGV.include?('--verify')
  %w[AppleBillingPlugin.swift MainViewController.swift].each do |name|
    source = File.join(root, 'native-ios', name)
    destination = File.join(app, name)
    abort "Apple billing kaynak dosyası eksik veya eski: #{name}" unless
      File.file?(source) && File.file?(destination) && File.binread(source) == File.binread(destination)
    compiled = target.source_build_phase.files.any? do |entry|
      entry.file_ref && File.expand_path(entry.file_ref.real_path.to_s) == File.expand_path(destination)
    end
    abort "Apple billing dosyası App Compile Sources içinde değil: #{name}" unless compiled
  end
  doc = REXML::Document.new(File.read(File.join(app, 'Base.lproj/Main.storyboard')))
  initial_id = doc.root.attributes['initialViewController']
  controller = REXML::XPath.match(doc, '//viewController').find { |v| v.attributes['id'] == initial_id }
  abort 'Başlangıç view controller MainViewController değil.' unless controller &&
    controller.attributes['customClass'] == 'MainViewController' &&
    controller.attributes['customModule'] == 'App' &&
    controller.attributes['customModuleProvider'] == 'target'
  puts 'VERIFIED: AppleBilling kaynakları, Compile Sources ve başlangıç controller bağlantısı doğru.'
  exit 0
end
%w[AppleBillingPlugin.swift MainViewController.swift].each do |name|
  source = File.join(root, 'native-ios', name)
  abort "Eksik dosya: #{name}" unless File.file?(source)
  FileUtils.cp(source, File.join(app, name))
  reference = group.files.find { |f| f.path == name } || group.new_file(name)
  target.source_build_phase.add_file_reference(reference, true)
end
storyboard = File.join(app, 'Base.lproj/Main.storyboard')
doc = REXML::Document.new(File.read(storyboard))
controllers = REXML::XPath.match(doc, '//viewController').select { |v| ['CAPBridgeViewController', 'MainViewController'].include?(v.attributes['customClass']) }
abort 'Beklenen Capacitor view controller bulunamadı; mevcut özel controller korunuyor.' unless controllers.length == 1
controller = controllers.first
controller.attributes['customClass'] = 'MainViewController'
controller.attributes['customModule'] = 'App'
controller.attributes['customModuleProvider'] = 'target'
File.open(storyboard, 'w') { |f| doc.write(f) }
project.save
puts 'AppleBilling Swift kaynakları App targetına eklendi ve MainViewController kaydedildi.'
