import './App.css'

const tools = [
  { id: 'tool-1', title: 'Tool 01', image: '/tools/tool-1.svg' },
  { id: 'tool-2', title: 'Tool 02', image: '/tools/tool-2.svg' },
  { id: 'tool-3', title: 'Tool 03', image: '/tools/tool-3.svg' },
  { id: 'tool-4', title: 'Tool 04', image: '/tools/tool-4.svg' },
]

function Header() {
  return (
    <header className="header">
      <a className="logo" href="/" aria-label="FedEx tools home">
        <span>Fed</span><span>Ex</span>
      </a>
      <span className="header-label">TOOLS</span>
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
        <main className="tool-page">
          <a className="back-link" href="/">← All tools</a>
          <img className="tool-page-image" src={selectedTool.image} alt="" />
          <p className="eyebrow">YOUR NEXT PROJECT</p>
          <h1>{selectedTool.title}</h1>
          <p className="description">This page is ready for your tool.</p>
          <span className="coming-soon">Coming soon</span>
        </main>
      ) : (
        <main className="home">
          <section className="intro">
            <p className="eyebrow">WELCOME</p>
            <h1>FedEx tools</h1>
            <p className="description">Choose a tool to get started.</p>
          </section>
          <section className="tool-grid" aria-label="Tools">
            {tools.map((tool, index) => (
              <a className="tool-card" href={`/tools/${tool.id}`} key={tool.id}>
                <img src={tool.image} alt="" />
                <div className="tool-card-copy">
                  <span className="tool-number">TOOL 0{index + 1}</span>
                  <h2>{tool.title}</h2>
                  <p>Your tool goes here</p>
                </div>
                <span className="card-arrow" aria-hidden="true">↗</span>
              </a>
            ))}
          </section>
        </main>
      )}
      <footer className="footer">© 2026 FedEx. Tools coming soon.</footer>
    </div>
  )
}

export default App
