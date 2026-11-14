import asyncio
import hmac
import logging
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Protocol

from flask import Flask, Response, jsonify, request
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

from ai_buddy.assessment import AssessmentRequest, AssessmentResult, AssessmentRunner
from ai_buddy.config import Settings
from ai_buddy.errors import ErrorCode, ServiceError
from ai_buddy.mcp_client import Gateway, Session, sdk_session
from ai_buddy.runner import DirectRunner
from ai_buddy.schemas import Reply, TurnRequest


class TurnRunner(Protocol):
    async def run(self, context: TurnRequest, gateway: Gateway) -> Reply: ...


SessionFactory = Callable[[TurnRequest], AbstractAsyncContextManager[Session]]


def create_app(
    settings: Settings | None = None,
    *,
    runner: TurnRunner | None = None,
    session_factory: SessionFactory | None = None,
) -> Flask:
    settings = settings or Settings.from_env()
    app = Flask(__name__)
    app.logger.setLevel(logging.INFO)
    if runner is None and settings.agent_enabled and settings.model_configured:
        runner = DirectRunner(settings, logger=app.logger)
    app.config["MAX_CONTENT_LENGTH"] = 64 * 1024
    factory = session_factory or (lambda context: sdk_session(settings, context))

    def error_response(code: ErrorCode, status: int) -> tuple[Response, int]:
        # Do not echo provider, tool, validation or exception text (it may contain secrets).
        return jsonify(
            error={
                "code": code.value,
                "message": "Запрос не выполнен. Проверьте статус и повторите позже.",
            }
        ), status

    def authorized() -> bool:
        expected = settings.service_token
        supplied = request.headers.get("Authorization", "")
        return expected is not None and hmac.compare_digest(
            supplied.encode("utf-8"),
            ("Bearer " + expected.get_secret_value()).encode("utf-8"),
        )

    @app.get("/health/ready/assessments")
    def assessment_ready() -> tuple[Response, int]:
        ok = (
            settings.service_token is not None
            and settings.agent_enabled
            and settings.model_configured
        )
        return jsonify(ready=ok), 200 if ok else 503

    @app.post("/internal/v1/assessments")
    def assessment() -> tuple[Response, int]:
        if not authorized():
            return error_response(ErrorCode.UNAUTHORIZED, 401)
        if not request.is_json:
            return error_response(ErrorCode.INVALID_REQUEST, 415)
        try:
            data = AssessmentRequest.model_validate_json(request.get_data(cache=False))
        except RequestEntityTooLarge:
            return error_response(ErrorCode.INVALID_REQUEST, 413)
        except (ValidationError, BadRequest):
            return error_response(ErrorCode.INVALID_REQUEST, 400)
        if not settings.agent_enabled:
            return error_response(ErrorCode.AI_UNAVAILABLE, 503)
        if not settings.model_configured:
            return error_response(ErrorCode.NOT_READY, 503)

        async def execute_assessment() -> AssessmentResult:
            async with asyncio.timeout(settings.turn_timeout):
                return await AssessmentRunner(settings, app.logger).run(data)

        try:
            result = asyncio.run(execute_assessment())
        except TimeoutError:
            return error_response(ErrorCode.AI_TIMEOUT, 503)
        except ServiceError as error:
            return error_response(error.code, 503)
        except Exception:  # noqa: BLE001 -- no learner answer or provider details leave HTTP boundary
            app.logger.warning(
                "assessment_failed code=INTERNAL_ERROR request_id=%s", data.request_id
            )
            return error_response(ErrorCode.AI_UNAVAILABLE, 503)
        return jsonify(
            request_id=str(data.request_id),
            conversation_id=str(data.conversation_id),
            assessment=result.model_dump(mode="json"),
        ), 200

    @app.get("/health/live")
    def live() -> Response:
        return jsonify(status="alive")

    @app.get("/health/ready")
    def ready() -> tuple[Response, int]:
        ok = settings.configured and runner is not None
        return jsonify(ready=ok), 200 if ok else 503

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(error: RequestEntityTooLarge) -> tuple[Response, int]:
        return error_response(ErrorCode.INVALID_REQUEST, 413)

    @app.post("/internal/v1/turns")
    def turn() -> tuple[Response, int]:
        if not authorized():
            return error_response(ErrorCode.UNAUTHORIZED, 401)
        if not request.is_json:
            return error_response(ErrorCode.INVALID_REQUEST, 415)
        try:
            raw = request.get_data(cache=False)
            context = TurnRequest.model_validate_json(raw)
        except RequestEntityTooLarge:
            return error_response(ErrorCode.INVALID_REQUEST, 413)
        except (ValidationError, BadRequest):
            return error_response(ErrorCode.INVALID_REQUEST, 400)
        if not settings.configured:
            return error_response(ErrorCode.NOT_READY, 503)
        if runner is None:
            return error_response(
                ErrorCode.NOT_READY
                if settings.agent_enabled
                else ErrorCode.AI_UNAVAILABLE,
                503,
            )

        async def execute() -> Reply:
            async with asyncio.timeout(settings.turn_timeout):
                async with factory(context) as session:
                    gateway = Gateway(session, context, settings)
                    await gateway.discover()
                    return await runner.run(context, gateway)

        try:
            reply = asyncio.run(execute())
            reply = Reply.model_validate(reply)
        except TimeoutError:
            return error_response(ErrorCode.AI_TIMEOUT, 503)
        except ServiceError as error:
            app.logger.warning(
                "ai_turn_failed code=%s request_id=%s",
                error.code.value,
                context.request_id,
            )
            return error_response(error.code, 503)
        except Exception:  # noqa: BLE001 -- final HTTP boundary must not expose exception text
            app.logger.warning(
                "ai_turn_failed code=INTERNAL_ERROR request_id=%s", context.request_id
            )
            return error_response(ErrorCode.AI_UNAVAILABLE, 503)
        return jsonify(
            request_id=str(context.request_id),
            conversation_id=str(context.conversation_id),
            reply=reply.model_dump(),
        ), 200

    return app
