# =============================================================
# GET /approvals - 승인 콜백 엔드포인트
#
# 이메일 링크에서 브라우저로 호출됩니다.
# /alerts 와 달리 HMAC authorizer를 적용하지 않습니다:
# 브라우저는 커스텀 헤더를 붙일 수 없기 때문입니다.
# 인증은 approval_id(추측 불가능 + 일회용 + TTL)가 담당합니다.
# =============================================================

resource "aws_api_gateway_resource" "approvals" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "approvals"
}

resource "aws_api_gateway_method" "get_approvals" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.approvals.id
  http_method   = "GET"
  authorization = "NONE"

  # API 키도 요구하지 않습니다. 브라우저 링크에 키를 넣으면
  # 이메일과 브라우저 히스토리에 키가 남습니다.
  api_key_required = false

  request_parameters = {
    "method.request.querystring.id"       = true
    "method.request.querystring.decision" = true
  }
}

resource "aws_api_gateway_integration" "approvals" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.approvals.id
  http_method = aws_api_gateway_method.get_approvals.http_method

  # AWS_PROXY는 요청 전체를 Lambda에 넘기고 Lambda의 응답을 그대로 반환합니다.
  # HTML을 돌려줘야 하므로 매핑 템플릿을 쓰는 것보다 간단합니다.
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.approval_callback.invoke_arn
}

resource "aws_lambda_permission" "approval_callback" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.approval_callback.function_name
  principal     = "apigateway.amazonaws.com"

  # 이 API의 이 메서드에서만 호출 가능하게 제한합니다.
  source_arn = "${aws_api_gateway_rest_api.main.execution_arn}/*/GET/approvals"
}
