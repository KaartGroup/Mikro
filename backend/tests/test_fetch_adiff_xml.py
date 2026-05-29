"""
Tests for AdiffAnalyzer.fetch_adiff_xml.

Mocks at the HTTP layer so the full fetch+strip path is exercised,
catching encoding and regex issues that session-level mocks would miss.
"""

from unittest.mock import MagicMock

import pytest

from api.utils.adiff_analyzer import AdiffAnalyzer


def _make_resp(lines, status_code=200, encoding="utf-8"):
    resp = MagicMock()
    resp.status_code = status_code
    resp.encoding = encoding
    resp.iter_lines.return_value = [
        line.encode(encoding) if isinstance(line, str) else line
        for line in lines
    ]
    return resp


def _analyzer(resp):
    session = MagicMock()
    session.get.return_value = resp
    return AdiffAnalyzer(session=session)


# ---------------------------------------------------------------------------
# Basic fetch behaviour
# ---------------------------------------------------------------------------

class TestFetchAdiffXml:
    def test_returns_xml_string(self):
        resp = _make_resp(["<osm>", "</osm>"])
        result = _analyzer(resp).fetch_adiff_xml(123)
        assert isinstance(result, str)
        assert "<osm>" in result

    def test_returns_none_on_404(self):
        resp = _make_resp([], status_code=404)
        result = _analyzer(resp).fetch_adiff_xml(123)
        assert result is None

    def test_returns_none_on_request_exception(self):
        import requests
        session = MagicMock()
        session.get.side_effect = requests.RequestException("timeout")
        result = AdiffAnalyzer(session=session).fetch_adiff_xml(123)
        assert result is None

    def test_streams_with_stream_true(self):
        resp = _make_resp(["<osm/>"])
        analyzer = _analyzer(resp)
        analyzer.fetch_adiff_xml(123)
        session = analyzer.session
        _, kwargs = session.get.call_args
        assert kwargs.get("stream") is True

    def test_decodes_bytes_lines(self):
        """iter_lines returns bytes — must not raise TypeError on the regex."""
        resp = _make_resp(["<osm>", "<action/>", "</osm>"])
        result = _analyzer(resp).fetch_adiff_xml(123)
        assert result is not None

    def test_decodes_bytes_lines_latin1(self):
        resp = _make_resp(["<osm>", "</osm>"], encoding="latin-1")
        result = _analyzer(resp).fetch_adiff_xml(123)
        assert result is not None

    def test_fallback_encoding_when_none(self):
        resp = _make_resp(["<osm/>"])
        resp.encoding = None
        result = _analyzer(resp).fetch_adiff_xml(123)
        assert result is not None


# ---------------------------------------------------------------------------
# nd / bounds stripping
# ---------------------------------------------------------------------------

class TestStripping:
    def test_nd_lines_removed(self):
        lines = [
            "<osm>",
            '  <nd ref="123" version="1" lon="1.0" lat="2.0"/>',
            "</osm>",
        ]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert "<nd" not in result
        assert "<osm>" in result

    def test_bounds_lines_removed(self):
        lines = [
            "<osm>",
            '  <bounds minlat="-33.0" minlon="-71.0" maxlat="-32.0" maxlon="-70.0"/>',
            "</osm>",
        ]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert "<bounds" not in result

    def test_tag_lines_kept(self):
        lines = [
            "<osm>",
            '  <tag k="highway" v="residential"/>',
            "</osm>",
        ]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert '<tag k="highway"' in result

    def test_nd_and_bounds_stripped_together(self):
        lines = [
            "<osm>",
            '  <bounds minlat="-1" minlon="-1" maxlat="1" maxlon="1"/>',
            '  <nd ref="1" version="1" lon="0.0" lat="0.0"/>',
            '  <tag k="name" v="Main St"/>',
            "</osm>",
        ]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert "<bounds" not in result
        assert "<nd" not in result
        assert "<tag" in result

    def test_member_opening_and_closing_lines_removed(self):
        lines = [
            "<osm>",
            '  <member type="way" ref="323686737" role="outer">',
            "  </member>",
            '  <tag k="type" v="multipolygon"/>',
            "</osm>",
        ]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert "<member" not in result
        assert "</member>" not in result
        assert "<tag" in result

    def test_self_closing_member_removed(self):
        lines = ["<osm>", '  <member type="node" ref="1" role=""/>', "</osm>"]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert "<member" not in result

    def test_action_and_way_structure_preserved(self):
        lines = [
            "<osm>",
            "  <action type=\"modify\">",
            "    <old>",
            "      <way id=\"1\">",
            '        <nd ref="10" version="1" lon="1.0" lat="2.0"/>',
            '        <tag k="highway" v="secondary"/>',
            "      </way>",
            "    </old>",
            "  </action>",
            "</osm>",
        ]
        result = _analyzer(_make_resp(lines)).fetch_adiff_xml(1)
        assert '<action type="modify">' in result
        assert "<way" in result
        assert '<tag k="highway"' in result
        assert "<nd" not in result
