unit HOSxPPCUAccount2PersonAncServiceDetailListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxCalendar, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2PersonAncServiceDetailListFrame = class(TFrame)
   JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
  
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1DBColumn1: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    PersonANCServiceDetailListCDS: TClientDataSet;
    PersonANCServiceDetailListDS: TDataSource;
   
    AddButton: TcxButton;
    EditButton: TcxButton;
    LogViewButton: TcxButton;
    cxGrid1DBTableView1vaccine_expire_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_lotno: TcxGridDBColumn;
    cxGrid1DBTableView1anc_service_name: TcxGridDBColumn;
    cxGrid1DBTableView1Column1: TcxGridDBColumn;
    
    procedure cxGrid1DBTableView1DBColumn1GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);

    procedure AddButtonClick(Sender: TObject);
    procedure EditButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
  private
    FPersonANCServiceID: integer;
    FVN: String;
    { Private declarations }
    
    procedure RefreshData;
    procedure SetPersonANCServiceID(const Value: integer);
    procedure SetVN(const Value: String);
  public
    { Public declarations }

    property PersonANCServiceID : integer read FPersonANCServiceID write SetPersonANCServiceID;
    property VN : String read FVN write SetVN;
  end;



implementation
uses HOSxPDMU,BMSApplicationUtil;


{$R *.dfm}

procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.AddButtonClick(Sender: TObject);
begin
   ExecuteRTTIFunction('HOSxPPCUAccount2PersonAncServiceDetailEntryFormUnit.THOSxPPCUAccount2PersonAncServiceDetailEntryForm','DoShowForm',[fvn,FPersonANCServiceID,0]);
   RefreshData;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.EditButtonClick(Sender: TObject);
begin
    if PersonANCServiceDetailListCDS.RecordCount=0 then
   exit;
   ExecuteRTTIFunction('HOSxPPCUAccount2PersonAncServiceDetailEntryFormUnit.THOSxPPCUAccount2PersonAncServiceDetailEntryForm','DoShowForm',[fvn,FPersonANCServiceID,
   PersonANCServiceDetailListCDS.FieldByName('person_anc_service_detail_id').AsInteger
   ]);
   RefreshData;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.LogViewButtonClick(Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_service_detail"',
    '']);
end;



procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.cxGrid1DBTableView1DBColumn1GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;


procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.RefreshData;
var V:Variant;
begin

   v := 0;

   if PersonANCServiceDetailListCDS.active then
   if PersonANCServiceDetailListCDS.recordcount>0 then
   V:=PersonANCServiceDetailListCDS.fieldbyname('person_anc_service_detail_id').asVariant;

  PersonANCServiceDetailListCDS.Data:=HOSxP_GetDataSet(
  'select p1.* ,a1.anc_service_name,d1.name as doctor_name '+
  ' from person_anc_service_detail p1 '+
  ' left outer join anc_service a1 on a1.anc_service_id  = p1.anc_service_id'+
  ' left outer join doctor d1 on d1.code = p1.anc_doctor_code '+
  ' where p1.person_anc_service_id = '+inttostr(FPersonANCServiceID)+
  ' order by p1.person_anc_service_detail_id '
  );

  if v >0 then
  PersonANCServiceDetailListCDS.locate('person_anc_service_detail_id',vararrayof([v]),[]);

end;

procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.SetPersonANCServiceID(
  const Value: integer);
begin
  FPersonANCServiceID := Value;
  RefreshData;
end;

procedure THOSxPPCUAccount2PersonAncServiceDetailListFrame.SetVN(
  const Value: String);
begin
  FVN := Value;
end;

end.
