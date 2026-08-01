// Par de dados acessível para gráficos Recharts (SVG puro, sem semântica
// para leitor de tela). Visualmente oculto (sr-only) — mesma informação do
// gráfico, em tabela real, para quem não consegue ler o SVG. Só
// GranularityDetailTable tinha esse par antes (achado da critique).
export function ChartDataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={index}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
