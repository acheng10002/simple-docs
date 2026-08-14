import { useState } from 'react'

function App() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault()
    if (email) {
      setSubmitted(true)
      setEmail('')
    }
  }

  return (
    <div className="font-['DM_Sans'] text-text bg-white">
      {/* Nav */}
      <nav className="fixed top-0 w-full bg-white/90 backdrop-blur-sm border-b border-gray-100 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-white text-sm font-bold">M</span>
            </div>
            <span className="text-lg font-semibold text-text">MergeMyDocs</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm text-text-secondary hover:text-text transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-text-secondary hover:text-text transition-colors">How It Works</a>
            <a href="#pricing" className="text-sm text-text-secondary hover:text-text transition-colors">Pricing</a>
            <a href="#contact" className="text-sm bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">Get Early Access</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl font-bold text-text leading-tight tracking-tight mb-6">
            Document templating,<br />simplified.
          </h1>
          <p className="text-xl text-text-secondary mb-10 max-w-2xl mx-auto leading-relaxed">
            Upload a template, fill its placeholders with your data, and export to the format you need. Single records or thousands via CSV — MergeMyDocs handles it.
          </p>
          <form onSubmit={handleWaitlist} className="flex gap-3 max-w-md mx-auto">
            {submitted ? (
              <div className="w-full bg-green-50 text-green-700 py-3 px-4 rounded-lg text-sm font-medium">
                You're on the list! We'll be in touch.
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  className="flex-1 px-4 py-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <button type="submit" className="bg-primary text-white px-6 py-3 rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors whitespace-nowrap">
                  Get Early Access
                </button>
              </>
            )}
          </form>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20 px-6 bg-bg">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-text mb-4">How it works</h2>
          <p className="text-text-secondary text-center mb-14 max-w-xl mx-auto">Three steps. No builder to learn, no complex setup.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <span className="text-primary text-2xl font-bold">1</span>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-text">Upload your template</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Upload a DOCX, HTML, PDF, XLSX, or PPTX file with <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{'{{placeholders}}'}</code> where your data goes.
              </p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <span className="text-primary text-2xl font-bold">2</span>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-text">Send your data</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Fill in field values manually, upload a CSV for batch processing, or trigger merges via the API or webhooks.
              </p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
                <span className="text-primary text-2xl font-bold">3</span>
              </div>
              <h3 className="font-semibold text-lg mb-2 text-text">Get your document</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Download your merged document in PDF, DOCX, HTML, XLSX, PPTX, PPSX, or JPG — whatever you need.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-text mb-4">Built for teams that merge documents</h2>
          <p className="text-text-secondary text-center mb-14 max-w-xl mx-auto">Everything you need to automate document generation — without the complexity.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: 'Format flexibility',
                desc: '5 template formats, 7 output formats. DOCX, HTML, PDF, XLSX, PPTX in — PDF, DOCX, HTML, XLSX, PPTX, PPSX, JPG out.',
              },
              {
                title: 'Simple setup',
                desc: 'Upload a template with {{placeholders}}, send data, get your document. No drag-and-drop builder to learn.',
              },
              {
                title: 'Batch processing',
                desc: 'Upload a CSV to merge hundreds of documents at once. Small batches run inline; large ones process in the background.',
              },
              {
                title: 'API & webhooks',
                desc: 'Integrate with any system via REST API or HMAC-signed webhooks. No middleware dependency required.',
              },
              {
                title: 'Self-hostable',
                desc: 'Deploy on your own infrastructure with Docker. Full control over your data for teams with residency requirements.',
              },
              {
                title: 'Competitive pricing',
                desc: 'Straightforward plans designed to undercut the incumbents. Details coming soon.',
              },
            ].map((feature) => (
              <div key={feature.title} className="bg-bg rounded-xl p-6">
                <h3 className="font-semibold text-text mb-2">{feature.title}</h3>
                <p className="text-text-secondary text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Format Support */}
      <section className="py-20 px-6 bg-bg">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-text mb-4">Output formats by template type</h2>
          <p className="text-text-secondary text-center mb-10">Upload in one format, export in another.</p>
          <div className="bg-white rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 font-semibold text-text-secondary">Template</th>
                  <th className="px-6 py-3 font-semibold text-text-secondary">Available outputs</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { template: 'DOCX', outputs: 'PDF, DOCX, HTML, JPG' },
                  { template: 'HTML', outputs: 'PDF, DOCX, HTML' },
                  { template: 'PDF', outputs: 'PDF, JPG' },
                  { template: 'XLSX', outputs: 'XLSX, PDF' },
                  { template: 'PPTX', outputs: 'PPTX, PPSX, PDF, JPG' },
                ].map((row) => (
                  <tr key={row.template} className="border-t border-gray-100">
                    <td className="px-6 py-3 font-medium text-text">{row.template}</td>
                    <td className="px-6 py-3 text-text-secondary">{row.outputs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-text mb-4">Pricing</h2>
          <p className="text-text-secondary mb-10 max-w-xl mx-auto">
            Simple, transparent plans — built to give you more value than the alternatives. Details coming soon.
          </p>
          <div className="bg-bg rounded-xl p-10">
            <p className="text-text-secondary text-lg mb-6">Pricing plans are being finalized.</p>
            <a href="#contact" className="inline-block bg-primary text-white px-6 py-3 rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
              Get notified when we launch
            </a>
          </div>
        </div>
      </section>

      {/* CTA / Contact */}
      <section id="contact" className="py-20 px-6 bg-bg">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-text mb-4">Get in touch</h2>
          <p className="text-text-secondary text-center mb-10">Interested in MergeMyDocs? We'd love to hear from you.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl p-8 text-center">
              <h3 className="font-semibold text-text mb-2">Request a demo</h3>
              <p className="text-text-secondary text-sm mb-4">See MergeMyDocs in action with a personalized walkthrough.</p>
              <a href="mailto:demo@mergemydocs.com" className="inline-block bg-primary text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors">
                Request a Demo
              </a>
            </div>
            <div className="bg-white rounded-xl p-8 text-center">
              <h3 className="font-semibold text-text mb-2">Contact sales</h3>
              <p className="text-text-secondary text-sm mb-4">Have questions about pricing, enterprise features, or self-hosting?</p>
              <a href="mailto:sales@mergemydocs.com" className="inline-block border border-primary text-primary px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary hover:text-white transition-colors">
                Contact Sales
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-gray-100">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <span className="text-white text-xs font-bold">M</span>
            </div>
            <span className="text-sm font-semibold text-text">MergeMyDocs</span>
          </div>
          <p className="text-xs text-text-secondary">&copy; {new Date().getFullYear()} MergeMyDocs. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

export default App
