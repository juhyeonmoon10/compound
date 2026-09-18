"use client";

import { Component, type ReactNode } from "react";
import "./panel-error-boundary.css";

type PanelErrorBoundaryProps = {
  label: string;
  children: ReactNode;
};

type PanelErrorBoundaryState = {
  failed: boolean;
};

// Keep the surrounding navigation and in-memory strategy mounted when a
// deferred panel cannot load, including stale chunks after a deployment.
export default class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="panel-load-error" role="alert" aria-label={`${this.props.label} 불러오기 오류`}>
        <strong>{this.props.label} 불러오기에 실패했습니다.</strong>
        <p>
          배포된 파일이 바뀌었거나 네트워크·화면 처리 오류가 발생했을 수 있습니다.
          다른 탭은 계속 사용할 수 있습니다.
        </p>
        <p className="panel-load-error__warning">
          새로고침하면 저장하지 않은 조건과 전략 입력이 초기화됩니다.
          필요한 내용은 먼저 기록해 주세요.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          페이지 새로고침
        </button>
      </section>
    );
  }
}
