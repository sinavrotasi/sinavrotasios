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
