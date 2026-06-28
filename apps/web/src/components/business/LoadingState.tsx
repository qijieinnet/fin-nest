type LoadingStateProps = {
  rows?: number;
  title?: string;
};

export function LoadingState({ rows = 3, title = "加载中" }: LoadingStateProps) {
  return (
    <div aria-busy="true" aria-label={title} className="biz-loading" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <span className="biz-loading__row" key={index} />
      ))}
    </div>
  );
}

