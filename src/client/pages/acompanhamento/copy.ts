// Textos compartilhados do módulo de Acompanhamento — centralizados para
// evitar variações de wording para o mesmo estado em componentes diferentes.
// LOADING_TEXT/ERROR_TEXT/RETRY_TEXT saíram daqui quando LoadingState/
// ErrorState viraram globais: agora vivem em @/components/AsyncState, único
// dono desse wording para o app inteiro.

export const NO_DATA_TEXT = "Nenhum dado encontrado para os filtros selecionados.";
export const SELECT_RESULT_TYPE_TEXT = "Selecione um Tipo de Resultado para continuar.";
export const SELECT_ENTITY_TEXT = "Selecione ao menos uma Entidade para continuar.";
