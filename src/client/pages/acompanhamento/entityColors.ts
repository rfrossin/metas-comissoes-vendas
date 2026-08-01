// Paleta categórica validada (skill dataviz, references/palette.md) — ordem
// fixa que passa o pior par adjacente em CVD/normal-vision nos dois modos.
const CATEGORICAL_ORDER = [
  "#2a78d6", // 1 blue
  "#008300", // 2 green
  "#e87ba4", // 3 magenta
  "#eda100", // 4 yellow
  "#1baf7a", // 5 aqua
  "#eb6834", // 6 orange
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
];

// Cor fixa por entityId, na ordem em que a entidade foi selecionada — nunca
// reciclada quando a seleção muda (regra do skill: cor segue a identidade,
// nunca a posição/rank). O chamador deve passar os ids em ordem estável de
// seleção (não ordenados/reordenados a cada render).
export function assignEntityColors(entityIdsInSelectionOrder: string[]): Map<string, string> {
  const map = new Map<string, string>();
  entityIdsInSelectionOrder.forEach((id, index) => {
    map.set(id, CATEGORICAL_ORDER[index % CATEGORICAL_ORDER.length]);
  });
  return map;
}
