// Reexporta os estados compartilhados de @/components/AsyncState — este
// módulo foi o primeiro a tratar erro de rede, e o padrão foi promovido
// para uso global. Mantido como reexport para não quebrar os imports
// relativos ("./AsyncState") já espalhados pelos componentes desta pasta.
export { ErrorState, LoadingState } from "@/components/AsyncState";
