import './App.css'
import AddressChecker from './AddressChecker.jsx'
import SpreadsheetTool from './SpreadsheetTool.jsx'

const tools = [
  { id: 'tool-1', title: 'Missing Packages Filter', image: '/tools/tool-1.svg', description: 'Upload, search, and filter spreadsheet data' },
  { id: 'tool-2', title: 'Tool 02', image: '/tools/tool-2.svg', description: 'Your tool goes here' },
  { id: 'tool-3', title: 'Address Checker', image: '/tools/tool-3.svg', description: 'Validate a U.S. mailing address' },
  { id: 'tool-4', title: 'Tool 04', image: '/tools/tool-4.svg', description: 'Your tool goes here' },
]

function Header() {
  return (
    <header className="header">
      <a className="logo" href="/" aria-label="FedEx tools home">
        <span className="logo-fed">Fed</span><span className="logo-ex">Ex</span>
      </a>
    </header>
  )
}

function App() {
  const toolId = window.location.pathname.split('/').filter(Boolean).at(-1)
  const selectedTool = tools.find((tool) => tool.id === toolId)

  return (
    <div className="page">
      <Header />
      {selectedTool ? (
        <main className={`tool-page ${selectedTool.id === 'tool-1' ? 'tool-page--spreadsheet' : ''}`}>
          <a className="back-link" href="/">← All tools</a>
          {selectedTool.id === 'tool-1' ? (
            <SpreadsheetTool />
          ) : selectedTool.id === 'tool-3' ? (
            <AddressChecker />
          ) : (
            <>
              <img className="tool-page-image" src={selectedTool.image} alt="" />
              <p className="eyebrow">YOUR NEXT PROJECT</p>
              <h1>{selectedTool.title}</h1>
              <p className="description">This page is ready for your tool.</p>
              <span className="coming-soon">Coming soon</span>
            </>
          )}
        </main>
      ) : (
        <main className="home">
          <section className="tools-section" id="tools" aria-label="Tools">
            <div className="section-heading">
              <h2>FedEx tools</h2>
            </div>
            <div className="tool-grid">
            {tools.map((tool, index) => (
              <a className="tool-card" href={`/tools/${tool.id}`} key={tool.id}>
                <div className="tool-card-art">
                  <img src={tool.image} alt="" />
                  <span className="tool-card-index">0{index + 1}</span>
                </div>
                <div className="tool-card-copy">
                  <span className="tool-number">
                    {index === 0 ? 'EXCEL TOOLS' : index === 2 ? 'ADDRESS TOOLS' : 'COMING SOON'}
                  </span>
                  <h2>{tool.title}</h2>
                  <p>{tool.description}</p>
                </div>
                <span className="card-arrow" aria-hidden="true">↗</span>
              </a>
            ))}
            </div>
          </section>
        </main>
      )}
      <footer className="footer">© 2026 FedEx. Tools for your workflow.</footer>
    </div>
  )
}

export default App
